import { NextResponse } from "next/server";
import { jsonErrorStatus, readJsonObjectLimited } from "../../../../../lib/api-json";
import { PublishPublicError } from "../../../../../lib/publish-security";
import { recordPublish, requireAuth } from "../../../../../lib/server";
import { listStaticDeployments, restoreStaticDeployment } from "../../../../../lib/static-hosting";
import {
  resolveStaticPublishContext,
  resolveStaticPublishWriteContext,
  STATIC_NO_STORE,
} from "../../../../../lib/static-hosting-route";

export const maxDuration = 30;

export async function GET(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const ctx = await resolveStaticPublishContext({
    site: params.get("site"),
    target: params.get("target"),
    provider: params.get("provider"),
    providerMismatchError: "The publishing provider changed.",
    access: "view",
  });
  if (ctx instanceof NextResponse) return ctx;
  try {
    return NextResponse.json({
      provider: ctx.conf.provider,
      deployments: await listStaticDeployments(ctx.siteId, ctx.target),
    }, { headers: STATIC_NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: error instanceof PublishPublicError ? error.message : "Couldn't read deployment history." },
      { status: 502, headers: STATIC_NO_STORE });
  }
}

export async function POST(req: Request) {
  const denied = await requireAuth("editor");
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = await readJsonObjectLimited(req, 2048);
  } catch (error) {
    return NextResponse.json({ error: "Invalid rollback request." }, { status: jsonErrorStatus(error) });
  }
  const ctx = await resolveStaticPublishWriteContext({
    site: body.site,
    target: body.target,
    provider: body.provider,
    providerMismatchError: "The publishing provider changed.",
  });
  if (ctx instanceof NextResponse) return ctx;
  if (typeof body.deploymentId !== "string") {
    return NextResponse.json({ error: "Invalid deployment ID." }, { status: 400 });
  }
  try {
    await restoreStaticDeployment(ctx.siteId, ctx.target, body.deploymentId);
    await recordPublish(ctx.siteId, ctx.target, ctx.dest.roomKey);
    return NextResponse.json({ ok: true }, { headers: STATIC_NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: error instanceof PublishPublicError ? error.message : "Couldn't restore the deployment." },
      { status: 502, headers: STATIC_NO_STORE });
  }
}
