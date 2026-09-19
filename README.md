# Telegram Drive

Multi-user personal cloud "drive" that stores files in each user's own
Telegram account (Saved Messages) via MTProto (GramJS). Runs on Next.js
(App Router) — deploys to Vercel or self-hosts identically.

## How it works
- Login: phone → Telegram code → GramJS StringSession stored in Postgres
  (api_id/api_hash are YOURS from my.telegram.org; users don't need their own).
- Files split into 4 MiB parts; each part is one Telegram `sendFile("me")`
  message. Index: part message-ID chain in Postgres.
- Uploads are client-chunked (≤4 MB per request) — this is mandatory on
  Vercel (4.5 MB hard request/response body cap) and keeps anything working.
- Downloads / Range requests map byte ranges → part → `upload.GetFile`.
- WebDAV at /api/wdav/** (PROPFIND/MKCOL/GET/PUT/DELETE) for davfs2 etc.

## Limits (per current Telegram + Vercel docs)
- 2 GiB per file (Telegram free; 4 GiB with Premium), unlimited count.
- Vercel Hobby maxDuration 60s config in vercel.json (Pro: 800s).
- 4.5 MB request/response body — hard, not configurable.

## Setup
cp .env.example .env   # fill DATABASE_URL, TELEGRAM_API_ID, TELEGRAM_API_HASH
npx drizzle-kit push   # create tables
npm run dev            # http://localhost:3000
vercel deploy          # same env vars in Vercel dashboard

## Status / TODO
- DONE: auth flow, chunked upload, list/browse/delete UI, Range-download
  streaming, WebDAV (PROPFIND/MKCOL/PUT/DELETE/GET).
- TODO: 2FA password step (SESSION_PASSWORD_NEEDED returns explicit error now),
  WebDAV Basic Auth (currently cookie-based — davfs2 needs Basic), garbage
  collection of unfinished uploads, per-part parallelism, e2e test with real
  api_id.
