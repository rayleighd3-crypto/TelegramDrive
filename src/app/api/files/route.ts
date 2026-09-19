// POST /api/files { action: 'mkdir', name, parentId } -> create folder
import { db } from "@/lib/db";
import { files } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  return requireUser(async (r: Request) => {
    const u = (r as any).tgUser;
    const body = await r.json();
    if (body.action === "mkdir") {
      const [f] = await db.insert(files).values({
        userId: u.id, parentId: body.parentId || null, name: body.name, isFolder: true,
      }).returning();
      return NextResponse.json({ id: f.id });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  })(req);
}
