// Chunked upload pipeline.
// POST /api/upload            { name, parentId, size, sha256 } -> { uploadId, partSize, parts }
// PUT  /api/upload?uploadId=  body: raw bytes of ONE part (≤4MB, host body cap) -> { parts: n, done? }
// POST /api/upload { action: 'finish', uploadId }              -> { fileId }
import { db } from "@/lib/db";
import { files, uploadSessions, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireUser, currentUser } from "@/lib/auth";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NextResponse } from "next/server";

const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH!;
const DEFAULT_PART = 4 * 1024 * 1024; // 4 MiB — under the 4.5MB host body cap
const MAX_FILE = 2 * 1024 * 1024 * 1024; // 2 GiB free-tier Telegram cap

async function userClient(user: any) {
  const c = new TelegramClient(new StringSession(user.tgSession), API_ID, API_HASH, { connectionRetries: 3 });
  await c.connect();
  // ensure the private storage channel exists
  let channelId = user.storageChannelId;
  if (!channelId) {
    const ch = await c.sendMessage("me", { message: "__tgdrive_init__" }).catch(() => null); // warm-up with Saved Messages
    channelId = null;
    // Use Saved Messages ("me") as the storage target — no channel creation needed,
    // works for every user, and messages are addressable by id.
    channelId = 0; // 0 == self
    await db.update(users).set({ storageChannelId: 0 }).where(eq(users.id, user.id));
  }
  return { client: c, channelId };
}

export async function POST(req: Request) {
  return requireUser(async (r: Request) => {
    const u = (r as any).tgUser;
    const body = await r.json();
    if (body.action === "finish") {
      const [s] = await db.select().from(uploadSessions).where(eq(uploadSessions.id, body.uploadId));
      if (!s || s.userId !== u.id) return NextResponse.json({ error: "not found" }, { status: 404 });
      const [f] = await db.insert(files).values({
        userId: u.id,
        parentId: s.parentId,
        name: s.name,
        size: s.size,
        mime: body.mime || "application/octet-stream",
        partMessageIds: s.messageIds,
        partSize: s.partSize,
      }).returning();
      await db.update(uploadSessions).set({ status: "done" }).where(eq(uploadSessions.id, s.id));
      return NextResponse.json({ fileId: f.id });
    }
    if (body.size > MAX_FILE) return NextResponse.json({ error: "file exceeds 2 GiB" }, { status: 413 });
    const parts = Math.ceil(body.size / DEFAULT_PART);
    const [s] = await db.insert(uploadSessions).values({
      userId: u.id, name: body.name, parentId: body.parentId || null,
      size: body.size, partSize: DEFAULT_PART,
    }).returning();
    return NextResponse.json({ uploadId: s.id, partSize: DEFAULT_PART, parts });
  })(req);
}

export async function PUT(req: Request) {
  return requireUser(async (r: Request) => {
    const u = (r as any).tgUser;
    const uploadId = new URL(r.url).searchParams.get("uploadId")!;
    const partIndex = Number(new URL(r.url).searchParams.get("part") || "0");
    const [s] = await db.select().from(uploadSessions).where(eq(uploadSessions.id, uploadId));
    if (!s || s.userId !== u.id) return NextResponse.json({ error: "not found" }, { status: 404 });

    const buf = Buffer.from(await r.arrayBuffer());
    const { client } = await userClient(u);
    // Saved Messages upload: sendDocument to "me"
    const msg = await client.sendFile("me", {
      file: buf,
      workers: 1,
      forceDocument: true,
      caption: JSON.stringify({ up: s.id, part: partIndex, name: s.name }),
    });
    const messageIds = [...(s.messageIds || [])];
    messageIds[partIndex] = msg.id;
    await db.update(uploadSessions).set({ messageIds }).where(eq(uploadSessions.id, uploadId));
    client.destroy();
    const done = messageIds.filter(Boolean).length >= Math.ceil(s.size / s.partSize);
    return NextResponse.json({ parts: messageIds.filter(Boolean).length, done });
  })(req);
}
