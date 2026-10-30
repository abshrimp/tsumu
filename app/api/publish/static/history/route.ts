import { NextResponse } from "next/server";
import { dbConfigured } from "../../../../../lib/db";
import { readJsonLimited, JsonBodyTooLargeError, JsonContentTypeError } from "../../../../../lib/api-json";
import { recordPublish, requireAuth } from "../../../../../lib/server";
import { requireSiteAccess } from "../../../../../lib/site-access";
import { siteDestOf, siteIdOf } from "../../../../../lib/site-server";
import { staticPublishConfig } from "../../../../../lib/publish-provider";
import { netlifyProjectStatus } from "../../../../../lib/netlify-deploy";
import { listStaticDeployments, restoreStaticDeployment } from "../../../../../lib/static-hosting";

export const maxDuration = 30;
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const siteId = await siteIdOf(params.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  const target = params.get("target");
  if (target !== "test" && target !== "production") {
    return NextResponse.json({ error: "Invalid publish target." }, { status: 400 });
  }
  if (!dbConfigured()) {
    return NextResponse.json({ error: "Static hosting requires server-backed sites." }, { status: 503 });
  }
  const siteDenied = await requireSiteAccess(siteId, "view");
  if (siteDenied) return siteDenied;
  try {
    const config = staticPublishConfig(siteId);
    if (!config.configured) return NextResponse.json({ error: config.error }, { status: 503 });
    if (config.provider === "netlify" && !(await netlifyProjectStatus(siteId)).connected) {
      return NextResponse.json({ error: "Connect a Netlify account and choose a team." }, { status: 409 });
    }
    if (params.get("provider") !== config.provider) {
      return NextResponse.json({ error: "The publishing provider changed." }, { status: 409 });
    }
    return NextResponse.json({
      provider: config.provider,
      deployments: await listStaticDeployments(siteId, config.provider, target),
    }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Couldn't read deployment history." },
      { status: 502, headers: NO_STORE });
  }
}

export async function POST(req: Request) {
  const denied = await requireAuth("editor");
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    const data = await readJsonLimited(req, 2048);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid request body.");
    body = data as Record<string, unknown>;
  } catch (error) {
    return NextResponse.json({ error: "Invalid rollback request." }, {
      status: error instanceof JsonBodyTooLargeError ? 413 :
        error instanceof JsonContentTypeError ? 415 : 400,
    });
  }
  const siteId = await siteIdOf(body.site);
  if (siteId instanceof NextResponse) return siteId;
  if (body.target !== "test" && body.target !== "production") {
    return NextResponse.json({ error: "Invalid publish target." }, { status: 400 });
  }
  if (!dbConfigured()) {
    return NextResponse.json({ error: "Static hosting requires server-backed sites." }, { status: 503 });
  }
  const siteDenied = await requireSiteAccess(siteId, "edit");
  if (siteDenied) return siteDenied;
  const dest = await siteDestOf(siteId);
  if (dest instanceof NextResponse) return dest;
  try {
    const config = staticPublishConfig(siteId);
    if (!config.configured) return NextResponse.json({ error: config.error }, { status: 503 });
    if (config.provider === "netlify" && !(await netlifyProjectStatus(siteId)).connected) {
      return NextResponse.json({ error: "Connect a Netlify account and choose a team." }, { status: 409 });
    }
    if (body.provider !== config.provider) {
      return NextResponse.json({ error: "The publishing provider changed." }, { status: 409 });
    }
    if (typeof body.deploymentId !== "string") {
      return NextResponse.json({ error: "Invalid deployment ID." }, { status: 400 });
    }
    await restoreStaticDeployment(siteId, config.provider, body.target, body.deploymentId);
    await recordPublish(siteId, body.target, dest.roomKey);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Couldn't restore the deployment." },
      { status: 502, headers: NO_STORE });
  }
}
