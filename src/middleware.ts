import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const url = request.nextUrl;

  // Root path (/) receives POST requests from Pub/Sub / Eventarc
  // Rewrite them to /api/cleanup with existing query parameters preserved
  if (request.method === "POST" && url.pathname === "/") {
    url.pathname = "/api/cleanup";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

// Apply middleware only to the root path to minimize overhead
export const config = {
  matcher: "/",
};
