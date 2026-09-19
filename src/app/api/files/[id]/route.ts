// GET /api/files/list?parentId=  -> list folder
// GET /api/files/[id]           -> metadata + byte stream (Range-supported, multi-part)
import { db } from "@/lib/db";
import { files } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { downloadRange } from "@/lib/downloader";
import { NextResponse } from "next/server";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return requireUser(async (r: Request) => {
    const u = (r as any).tgUser;
    const { id } = await params;

    if (id === "list") {
      const parentId = new URL(r.url).searchParams.get("parentId") || null;
      const rows = await db.select().from(files).where(
        and(eq(files.userId, u.id), eq(files.trashed, false),
          parentId ? eq(files.parentId, parentId) : isNull(files.parentId)));
      return NextResponse.json({ items: rows });
    }

    const [f] = await db.select().from(files).where(and(eq(files.id, id), eq(files.userId, u.id)));
    if (!f || f.isFolder) return NextResponse.json({ error: "not found" }, { status: 404 });

    const partSize = f.partSize!;
    const ids = f.partMessageIds ?? [];
    const total = f.size!;
    const range = r.headers.get("range");
    let start = 0, end = total - 1, partial = false;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        start = m[1] ? Number(m[1]) : 0;
        end = m[2] ? Number(m[2]) : total - 1;
        partial = true;
        if (start > end || start >= total) return new Response(null, { status: 416 });
      }
    }

    // Stream slice [start..end] across the part chain. Buffered per ~1MB pull:
    const stream = new ReadableStream({
      async pull(controller) {
        if (start > end) { controller.close(); return; }
        const want = Math.min(1024 * 1024, end - start + 1);
        const pIdx = Math.floor(start / partSize);
        const offsetInPart = start - pIdx * partSize;
        const msgId = ids[pIdx];
        if (!msgId) { controller.error(new Error("missing part " + pIdx)); return; }
        try {
          // a chunk must not cross into the next part's message
          const take = Math.min(want, partSize - offsetInPart);
          const buf = await downloadRange(u, msgId, offsetInPart, take);
          controller.enqueue(buf);
          start += buf.length;
        } catch (e) {
          controller.error(e);
        }
      },
      cancel() { /* client destroyed inside downloadRange */ },
    });

    const headers: Record<string, string> = {
      "Content-Type": f.mime || "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename="${encodeURIComponent(f.name)}"`,
    };
    if (partial) {
      headers["Content-Range"] = `bytes ${start}-${end}/${total}`;
      headers["Content-Length"] = String(end - start + 1);
    } else {
      headers["Content-Length"] = String(total);
    }
    return new Response(stream, { status: partial ? 206 : 200, headers });
  })(req);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return requireUser(async (r: Request) => {
    const u = (r as any).tgUser;
    const { id } = await params;
    const [f] = await db.select().from(files).where(and(eq(files.id, id), eq(files.userId, u.id)));
    if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });
    await db.update(files).set({ trashed: true }).where(eq(files.id, id));
    return NextResponse.json({ ok: true });
  })(req);
}
