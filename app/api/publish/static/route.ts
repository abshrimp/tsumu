import { NextResponse } from "next/server";
import { PublishPublicError } from "../../../../lib/publish-security";
import { recordPublish, requireAuth } from "../../../../lib/server";
import { deployStaticSite, readStaticZip, readZipRequest } from "../../../../lib/static-hosting";
import { resolveStaticPublishWriteContext, STATIC_NO_STORE } from "../../../../lib/static-hosting-route";

export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = await requireAuth("editor");
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const ctx = await resolveStaticPublishWriteContext({
    site: params.get("site"),
    target: params.get("target"),
    provider: params.get("provider"),
    providerMismatchError: "The publishing destination changed. Reopen the publish dialog.",
  });
  if (ctx instanceof NextResponse) return ctx;
  const { siteId, target, conf, dest } = ctx;
  const { project } = conf;
  if (params.get("project") !== project) {
    return NextResponse.json({ error: "The publishing destination changed. Reopen the publish dialog." }, { status: 409 });
  }
  try {
    const zip = await readZipRequest(req);
    const files = await readStaticZip(zip);
    const result = await deployStaticSite(siteId, target, files);
    await recordPublish(siteId, target, dest.roomKey);
    return NextResponse.json({
      provider: conf.provider,
      project,
      id: result.id,
      state: result.state,
      deploymentUrl: result.url,
      siteUrl: (target === "test" ? dest.previewUrl : dest.siteUrl) ||
        (target === "test" ? conf.previewUrl : conf.productionUrl),
    }, { headers: STATIC_NO_STORE });
  } catch (error) {
    // Never forward provider response bodies, internal runtime exceptions or auth headers to the browser.
    return NextResponse.json({
      error: error instanceof PublishPublicError ? error.message : "The deployment failed.",
    }, { status: 400, headers: STATIC_NO_STORE });
  }
}
