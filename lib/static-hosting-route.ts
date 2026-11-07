import { NextResponse } from "next/server";
import { dbConfigured } from "./db";
import type { PublishTarget } from "./generator";
import { staticPublishConfig, type StaticPublishConfig } from "./publish-provider";
import { requireSiteAccess } from "./site-access";
import { siteDestOf, siteIdOf } from "./site-server";
import type { SiteDest } from "./sites";

export const STATIC_NO_STORE = { "Cache-Control": "private, no-store" } as const;

export interface StaticPublishContext {
  siteId: string;
  target: PublishTarget;
  conf: StaticPublishConfig;
}

export async function resolveStaticPublishContext(options: {
  site: unknown;
  target: unknown;
  provider: unknown;
  providerMismatchError: string;
  access: "view" | "edit";
}): Promise<StaticPublishContext | NextResponse> {
  if (options.target !== "test" && options.target !== "production") {
    return NextResponse.json({ error: "Invalid publish target." }, { status: 400 });
  }
  const siteId = await siteIdOf(options.site);
  if (siteId instanceof NextResponse) return siteId;
  if (!dbConfigured()) {
    return NextResponse.json({ error: "Static hosting requires server-backed sites." }, { status: 503 });
  }
  const siteDenied = await requireSiteAccess(siteId, options.access);
  if (siteDenied) return siteDenied;
  let conf: StaticPublishConfig;
  try {
    conf = staticPublishConfig(siteId);
  } catch {
    return NextResponse.json({ error: "Static publishing is not configured." }, { status: 503 });
  }
  if (!conf.configured) {
    return NextResponse.json({ error: conf.error }, { status: 503 });
  }
  if (options.provider !== "cloudflare") {
    return NextResponse.json({ error: options.providerMismatchError }, { status: 409 });
  }
  return { siteId, target: options.target, conf };
}

export async function resolveStaticPublishWriteContext(options: {
  site: unknown;
  target: unknown;
  provider: unknown;
  providerMismatchError: string;
}): Promise<(StaticPublishContext & { dest: SiteDest & { roomKey?: string | null } }) | NextResponse> {
  const ctx = await resolveStaticPublishContext({ ...options, access: "edit" });
  if (ctx instanceof NextResponse) return ctx;
  const dest = await siteDestOf(ctx.siteId);
  if (dest instanceof NextResponse) return dest;
  return { ...ctx, dest };
}
