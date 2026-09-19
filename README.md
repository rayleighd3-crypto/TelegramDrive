# Telegram Drive

Multi-user personal cloud "drive" that stores files in each user's own
Telegram account (Saved Messages) via MTProto (GramJS). Next.js App Router;
deploys to Vercel or self-hosts identically.

## Features
- Phone + code login (MTProto user session, no bot token)
- Chunked uploads (4 MiB parts, resumable per part)
- Range-based streaming downloads
- WebDAV endpoint for mounting (davfs2, RaiDrive, etc.)
- SaaS-dashboard UI: sidebar, breadcrumbs, sortable table, grid view,
  search, multi-select bulk actions, row menus, details sheet, upload progress

## Architecture
- **Login**: phone → Telegram code → GramJS StringSession per user, stored in
  Postgres. One api_id/api_hash for the whole app (from my.telegram.org);
  users never need their own.
- **Files split into 4 MiB parts**; each part is one Telegram
  `sendFile("me")` document in the user's Saved Messages. The part→message-id
  chain lives in Postgres. This is mandatory on Vercel (4.5 MB hard
  request/response body cap) and works identically on a VPS.
- **Downloads / Range requests** map byte ranges → part index → MTProto
  `upload.GetFile` for byte-precise slices (no full-part buffering).

## Limits
- 2 GiB per file (Telegram free; 4 GiB with Premium), unlimited file count
- Vercel Hobby: 60s function cap (see `vercel.json`); Pro allows 800s
- 4.5 MB request/response body cap on Vercel — hard, not configurable

## Stack notes
- Styling is **hand-rolled CSS** (`src/app/globals.css`), no Tailwind build
  step: Tailwind v4's postcss transform deadlocks `next build` on
  low-memory machines, and plain CSS avoids the entire class of problem.
- `next build --webpack` is used deliberately: Turbopack's production build
  also wedges on constrained hardware.

## Setup
```
cp .env.example .env      # DATABASE_URL, TELEGRAM_API_ID, TELEGRAM_API_HASH
npx drizzle-kit push      # create tables
npm run dev               # http://localhost:3000
```
Deploy: import the repo on Vercel, set the same three env vars, deploy.
No build configuration needed beyond `vercel.json`.

## API surface
| Route | Purpose |
|---|---|
| `POST /api/auth` | `{step:"start"}` send code · `{step:"code"}` verify |
| `POST /api/upload` | create upload session · `{action:"finish"}` commit |
| `PUT /api/upload?uploadId=&part=` | upload one ≤4 MiB part |
| `GET /api/files/list?parentId=` | list folder |
| `GET /api/files/[id]` | stream (Range-supported) |
| `DELETE /api/files/[id]` | trash |
| `POST /api/files` | `{action:"mkdir"}` |
| `/api/wdav/**` | WebDAV: GET/PUT/DELETE + POST carrying `X-WebDAV-Method` |

## Status / TODO
- Working: auth flow, chunked upload, list/browse/delete, range download,
  WebDAV, full UI
- TODO: 2FA password step (`SESSION_PASSWORD_NEEDED` returns an explicit
  error today), WebDAV Basic Auth for davfs2 (currently cookie session),
  GC of abandoned upload sessions, per-part upload parallelism
