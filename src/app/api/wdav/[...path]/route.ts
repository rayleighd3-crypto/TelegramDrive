// WebDAV endpoint — mount with davfs2/Windows/RaiDrive.
// Supports: OPTIONS, PROPFIND (list), GET (stream), PUT (chunk to Telegram via parts), MKCOL, DELETE.
// Consolidated endpoint: /api/wdav/[...path]  for path mapping
import { db } from "@/lib/db";
import { files, uploadSessions } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { currentUser } from "@/lib/auth";
import { handleGet } from "../get-handler";

import { NextResponse } from "next/server";
import { Readable } from "stream";

type AnyCtx = { params: Promise<{ path?: string[] }> };

const XML_NS = 'xmlns:d="DAV:"';

function xmlEscape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function davProps(f: { name: string; isFolder: boolean; size: number | null; updatedAt: Date }) {
  const esc = xmlEscape(f.name);
  return `<d:response>
  <d:href>${esc}</d:href>
  <d:propstat><d:prop>
     <d:displayname>${esc}</d:displayname>
     ${f.isFolder ? `<d:resourcetype><d:collection/></d:resourcetype>` : `<d:resourcetype/><d:getcontentlength>${f.size ?? 0}</d:getcontentlength>`}
     <d:getlastmodified>${f.updatedAt.toUTCString()}</d:getlastmodified>
  </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
</d:response>`;
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      Allow: "OPTIONS, GET, PUT, DELETE, PROPFIND, MKCOL",
      DAV: "1",
      "MS-Author-Via": "DAV",
    },
  });
}

async function findNode(userId: string, path: string[]) {
  let parent: string | null = null;
  let node = null as any;
  for (const seg of path) {
    const [n] = await db.select().from(files).where(
      and(eq(files.userId, userId), eq(files.name, seg), eq(files.trashed, false),
        parent ? eq(files.parentId, parent) : isNull(files.parentId)));
    if (!n) return null;
    node = n; parent = n.id;
  }
  return node;
}

export async function PROPFIND(req: Request, ctx: AnyCtx) {
  return handleDav(req, ctx, "PROPFIND");
}
export async function GET(req: Request, ctx: AnyCtx) { return handleGet(req, ctx); }
export async function PUT(req: Request, ctx: AnyCtx) { return handleDav(req, ctx, "PUT"); }
export async function DELETE(req: Request, ctx: AnyCtx) { return handleDav(req, ctx, "DELETE"); }
export async function MKCOL(req: Request, ctx: AnyCtx) { return handleDav(req, ctx, "MKCOL"); }

async function handleDav(req: Request, ctx: AnyCtx, method: string) {
  const u = await currentUser();
  if (!u) return new Response("unauthorized", { status: 401 });
  const { path = [] } = await ctx.params;
  const depth = (req.headers.get("depth") || "0").trim();

  // Resolve parent segment chain + final segment
  const parentNode = await findNode(u.id, path.slice(0, -1));
  const name = path[path.length - 1];
  const node = await findNode(u.id, path);

  if (method === "PROPFIND") {
    const target = node ?? { name: path[path.length - 1] || "/", isFolder: true, size: null, updatedAt: new Date(), parentId: parentNode?.id ?? null };
    // Depth 1: list children of the target folder
    let children: any[] = [];
    if (depth === "1" && (target.isFolder !== false)) {
      children = await db.select().from(files).where(
        and(eq(files.userId, u.id), eq(files.trashed, false),
          target.parentId ? eq(files.parentId, target.parentId) : isNull(files.parentId)));
    }
    const body = `<?xml version="1.0"?><d:multistatus ${XML_NS}>${davProps(target as any)}${children.map(davProps).join("")}</d:multistatus>`;
    return new Response(body, { status: 207, headers: { "Content-Type": 'application/xml; charset="utf-8"' } });
  }

  if (method === "MKCOL") {
    await db.insert(files).values({ userId: u.id, parentId: parentNode?.id ?? null, name, isFolder: true });
    return new Response(null, { status: 201 });
  }

  if (method === "DELETE") {
    if (node) await db.update(files).set({ trashed: true }).where(eq(files.id, node.id));
    return new Response(null, { status: 204 });
  }

  if (method === "PUT") {
    // WebDAV clients send whole file. Cap by Telegram limits; chunk into partSize slices.
    const buf = Buffer.from(await req.arrayBuffer());
    // The host caps request bodies at 4.5MB anyway; small files only via this path.
    const [s] = await db.insert(uploadSessions).values({
      userId: u.id, name, parentId: parentNode?.id ?? null, size: buf.length, partSize: buf.length,
      messageIds: [], status: "open",
    }).returning();
    // send as one message
    const { TelegramClient } = await import("telegram");
    const { StringSession } = await import("telegram/sessions/index.js");
    const API_ID = Number(process.env.TELEGRAM_API_ID);
    const API_HASH = process.env.TELEGRAM_API_HASH!;
    const client = new TelegramClient(new StringSession(u.tgSession!), API_ID, API_HASH, { connectionRetries: 3 });
    await client.connect();
    const msg = await client.sendFile("me", { file: buf, workers: 1, forceDocument: true });
    client.destroy();
    await db.insert(files).values({
      userId: u.id, parentId: parentNode?.id ?? undefined, name, size: buf.length,
      mime: "application/octet-stream", partMessageIds: [msg.id], partSize: buf.length,
    });
    await db.update(uploadSessions).set({ status: "done" }).where(eq(uploadSessions.id, s.id));
    return new Response(null, { status: 201 });
  }

  return new Response("unsupported", { status: 405 });
}
