import { NextResponse } from "next/server";
import { dbConfigured } from "../../../../lib/db";
import { recordPublish, requireAuth } from "../../../../lib/server";
import { requireSiteAccess } from "../../../../lib/site-access";
import { siteDestOf, siteIdOf } from "../../../../lib/site-server";
import { staticPublishConfig } from "../../../../lib/publish-provider";
import { netlifyProjectStatus } from "../../../../lib/netlify-deploy";
import { deployStaticSite, readStaticZip, readZipRequest } from "../../../../lib/static-hosting";
import type { PublishTarget } from "../../../../lib/generator";

export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(req: Request) {
  const denied = await requireAuth("editor");
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const target = params.get("target");
  if (target !== "test" && target !== "production") {
    return NextResponse.json({ error: "Invalid publish target." }, { status: 400 });
  }
  const siteId = await siteIdOf(params.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  if (!dbConfigured()) {
    return NextResponse.json({ error: "Static hosting requires server-backed sites." }, { status: 503 });
  }
  const deniedSite = await requireSiteAccess(siteId, "edit");
  if (deniedSite) return deniedSite;
  const dest = await siteDestOf(siteId);
  if (dest instanceof NextResponse) return dest;
  let conf: ReturnType<typeof staticPublishConfig>;
  try {
    conf = staticPublishConfig(siteId);
  } catch {
    return NextResponse.json({ error: "Static publishing is not configured." }, { status: 503 });
  }
  if (!conf.configured) return NextResponse.json({ error: conf.error }, { status: 503 });
  const netlify = conf.provider === "netlify" ? await netlifyProjectStatus(siteId) : null;
  if (conf.provider === "netlify" && (!netlify?.bound || !netlify.connected)) {
    return NextResponse.json({ error: "The site's Netlify connection is missing. Reopen Site settings." }, { status: 409 });
  }
  const expectedProject = target === "test"
    ? netlify?.previewProject || conf.previewProject
    : netlify?.productionProject || conf.project;
  if (params.get("provider") !== conf.provider ||
      params.get("project") !== expectedProject) {
    return NextResponse.json({ error: "The publishing destination changed. Reopen the publish dialog." }, { status: 409 });
  }
  try {
    const zip = await readZipRequest(req);
    const files = await readStaticZip(zip);
    const result = await deployStaticSite(siteId, conf.provider, target as PublishTarget, zip, files);
    await recordPublish(siteId, target, dest.roomKey);
    return NextResponse.json({
      provider: conf.provider,
      project: expectedProject,
      id: result.id,
      state: result.state,
      deploymentUrl: result.url,
      siteUrl: (target === "test" ? dest.previewUrl : dest.siteUrl) ||
        (target === "test" ? netlify?.previewUrl || (conf.provider === "netlify" ? result.url : conf.previewUrl)
          : netlify?.productionUrl || (conf.provider === "netlify" ? result.url : conf.productionUrl)),
    }, { headers: NO_STORE });
  } catch (error) {
    // Never forward provider response bodies or authentication headers to the browser.
    return NextResponse.json({
      error: error instanceof Error ? error.message : "The deployment failed.",
    }, { status: 400, headers: NO_STORE });
  }
}
