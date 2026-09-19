import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import bigInt from "big-integer";

// Core singleton helpers. On Vercel, fluid compute keeps instances warm;
// on VPS, plain long-lived process.

const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH!;

export function makeClient(sessionString?: string) {
  const session = new StringSession(sessionString || "");
  return new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 3,
    deviceModel: "telegram-drive",
    systemVersion: "1.0",
  });
}

export async function ensureLoggedIn(client: TelegramClient, sessionString: string) {
  if (!sessionString) throw new Error("unauthenticated");
  await client.connect();
  if (!client.session) throw new Error("no session");
  return client;
}

export { bigInt, Api };
