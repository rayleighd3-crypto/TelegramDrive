import { NextResponse, type NextRequest } from "next/server";

// WebDAV uses PROPFIND/MKCOL — HTTP methods Next.js's route contract doesn't expose.
// Middleware rewrites those requests into POST + X-WebDAV-Method header; the route
// handler reads that header and dispatches to the right logic.

export function middleware(req: NextRequest) {
  const m = req.method.toUpperCase();
  if (m === "PROPFIND" || m === "MKCOL") {
    const headers = new Headers(req.headers);
    headers.set("x-webdav-method", m);
    return new NextResponse(null, { headers });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/wdav/:path*",
};
