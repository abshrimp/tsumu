import { NextResponse } from "next/server";
import { requireAuth } from "../../../../../lib/server";
import { inspectAdobeProject } from "../../../../../lib/adobe-fonts-project";

/** Only a fixed Adobe CDN origin and a strictly checked kit ID are requested. */
export async function GET(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  const kitId = URL.parse(request.url)?.searchParams.get("kitId") ?? "";
  if (!/^[a-z0-9]{7}$/.test(kitId)) {
    return NextResponse.json({ status: "invalid", fonts: [] }, { status: 400 });
  }

  const result = await inspectAdobeProject(kitId);
  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
