import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram";
import bigInt from "big-integer";

const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH!;

// Byte-precise download of a slice of ONE Telegram document message in Saved Messages.
// Does not buffer the whole part — iterates raw chunks so a Range request maps to part i's bytes.
export async function downloadRange(
  user: any,
  messageId: number,
  offsetInPart: number,
  length: number
): Promise<Buffer> {
  const client = new TelegramClient(new StringSession(user.tgSession), API_ID, API_HASH, { connectionRetries: 3 });
  await client.connect();
  try {
    const msg = await client.getMessages("me", { ids: [messageId] });
    const doc = (msg[0]?.media as Api.MessageMediaDocument)?.document as Api.Document;
    if (!doc) throw new Error("no document on message " + messageId);
    const loc = new Api.InputDocumentFileLocation({
      id: doc.id,
      accessHash: doc.accessHash,
      fileReference: doc.fileReference,
      thumbSize: "",
    });
    const chunks: Buffer[] = [];
    let got = 0;
    let offset = offsetInPart;
    while (got < length) {
      const reqSize = Math.min(512 * 1024, length - got);
      // requestSize must be divisible by 4096 (Telegram rule) except for the final slice
      const aligned = Math.ceil(reqSize / 4096) * 4096;
      const result = await client.invoke(
        new Api.upload.GetFile({
          location: loc,
          offset: bigInt(offset as any),
          limit: Math.min(aligned, 1024 * 1024),
        })
      );
      const buf = Buffer.from((result as any).buffer || (result as any).bytes);
      if (!buf.length) break;
      chunks.push(buf.subarray(0, Math.min(buf.length, length - got)));
      got += Math.min(buf.length, length - got);
      offset += buf.length;
    }
    return Buffer.concat(chunks);
  } finally {
    client.destroy();
  }
}

export const downloader = { downloadRange };
export const GET = undefined; // not a route
