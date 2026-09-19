type Handler = (req: Request, ctx?: any) => Response | Promise<Response>;

// Per-request Telegram client for a user, resolved from their stored StringSession.
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH!;

export async function currentUser() {
  const jar = await cookies();
  const uid = jar.get("tgdrive_uid")?.value;
  if (!uid) return null;
  const [u] = await db.select().from(users).where(eq(users.id, uid));
  return u ?? null;
}

export function requireUser(origHandler: Handler): Handler {
  return async (req: Request, ctx?: any) => {
    const u = await currentUser();
    if (!u || !u.tgSession) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    (req as any).tgUser = u;
    return origHandler(req as any, ctx);
  };
}
