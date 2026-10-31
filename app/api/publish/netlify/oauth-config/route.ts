import { NextResponse } from "next/server";
import { requireAuth } from "../../../../../lib/server";
import { netlifyOAuthConfig } from "../../../../../lib/netlify-publish";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    return NextResponse.json(netlifyOAuthConfig(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Netlify OAuth is not configured." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
