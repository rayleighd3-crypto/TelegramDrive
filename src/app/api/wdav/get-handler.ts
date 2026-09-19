import { currentUser } from "@/lib/auth";
import { files } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { downloadRange } from "@/lib/downloader";
import { db } from "@/lib/db";

export async function handleGet(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const u = await currentUser();
  if (!u) return new Response("unauthorized", { status: 401 });
  const { path = [] } = await ctx.params;

  // resolve the node by walking segments
  let parent: string | null = null;
  let node: any = null;
  for (const seg of path) {
    const [n] = await db.select().from(files).where(
      and(eq(files.userId, u.id), eq(files.name, seg), eq(files.trashed, false),
        parent ? eq(files.parentId, parent) : isNull(files.parentId)));
    if (!n) return new Response("not found", { status: 404 });
    node = n; parent = n.id;
  }
  if (!node || node.isFolder) return new Response("not found", { status: 404 });

  const range = req.headers.get("range");
  let start = 0, end = node.size - 1;
  let partial = false;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) { start = Number(m[1]) || 0; end = m[2] ? Number(m[2]) : node.size - 1; partial = true; }
  }
  const partSize = node.partSize!;

  const stream = new ReadableStream({
    async pull(c) {
      if (start > end) { c.close(); return; }
      const pIdx = Math.floor(start / partSize);
      const offsetInPart = start - pIdx * partSize;
      const msgId = (node.partMessageIds ?? [])[pIdx];
      if (!msgId) { c.error(new Error("missing part")); return; }
      const take = Math.min(1024 * 1024, end - start + 1, partSize - offsetInPart);
      const buf = await downloadRange(u, msgId, offsetInPart, take);
      c.enqueue(buf);
      start += buf.length;
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": node.mime || "application/octet-stream",
    "Accept-Ranges": "bytes",
  };
  if (partial) {
    headers["Content-Range"] = `bytes ${start}-${end}/${node.size}`;
    headers["Content-Length"] = String(end - start + 1);
  } else headers["Content-Length"] = String(node.size);
  return new Response(stream, { status: partial ? 206 : 200, headers });
}
