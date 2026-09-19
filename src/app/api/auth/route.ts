import { NextRequest, NextResponse } from "next/server";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { db } from "@/lib/db";
import { loginSessions, users } from "@/db/schema";
import { eq } from "drizzle-orm";

const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH!;

// POST /api/auth  { step: 'start', phone }             -> send code
// POST /api/auth  { step: 'code', phone, loginId, code } -> finish login
// GET  /api/auth?phone=&loginId=                     -> poll status
export async function POST(req: NextRequest) {
  if (!API_ID || !API_HASH) return NextResponse.json({ error: "server not configured (TELEGRAM_API_ID/HASH)" }, { status: 500 });
  const { step, phone, loginId, code } = await req.json();

  if (step === "start") {
    const client = new TelegramClient(new StringSession(""), API_ID, API_HASH, { connectionRetries: 3 });
    await client.connect();
    const { phoneCodeHash } = await client.sendCode({ apiId: API_ID, apiHash: API_HASH }, phone);
    const [row] = await db.insert(loginSessions).values({ phone, phoneCodeHash }).returning();
    const session = client.session.save() as unknown as string;
    client.destroy();
    // stash the session (auth key) in the row so the code-check step can reuse it
    await db.update(loginSessions).set({ signedSession: session }).where(eq(loginSessions.id, row.id));
    return NextResponse.json({ loginId: row.id, status: row.status });
  }

  if (step === "code") {
    const [row] = await db.select().from(loginSessions).where(eq(loginSessions.id, loginId));
    if (!row) return NextResponse.json({ error: "unknown loginId" }, { status: 404 });
    const client = new TelegramClient(new StringSession(row.signedSession!), API_ID, API_HASH, { connectionRetries: 3 });
    await client.connect();
    try {
      await client.signInUser(
        { apiId: API_ID, apiHash: API_HASH },
        {
          phoneNumber: phone,
          phoneCode: async () => code,
          phoneCodeHash: row.phoneCodeHash ?? undefined,
          password: undefined,
          onError: async (err: Error) => { throw err; },
        } as any
      );
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("SESSION_PASSWORD_NEEDED")) {
        return NextResponse.json({ status: "awaiting_password", error: "2FA password required (not yet handled in this build)" });
      }
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const sessionString = (client.session.save() as unknown as string);
    client.destroy(); // don't close-on-eof warnings

    await db.update(loginSessions).set({ status: "done", signedSession: null }).where(eq(loginSessions.id, loginId));
    const [u] = await db.insert(users).values({ phone, tgSession: sessionString }).returning();
    const res = NextResponse.json({ status: "done", userId: u.id });
    res.cookies.set("tgdrive_uid", u.id, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30, path: "/" });
    return res;
  }

  return NextResponse.json({ error: "unknown step" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const loginId = new URL(req.url).searchParams.get("loginId")!;
  const [row] = await db.select().from(loginSessions).where(eq(loginSessions.id, loginId));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ status: row.status });
}
