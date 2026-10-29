import { NextResponse } from "next/server";
import { requireAuth } from "../../../../lib/server";
import { publishProvider } from "../../../../lib/publish-provider";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    return NextResponse.json({ provider: publishProvider() }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Invalid publishing configuration" }, { status: 503 });
  }
}
