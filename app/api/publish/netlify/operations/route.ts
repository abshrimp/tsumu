import { NextResponse } from "next/server";
import { requireAuth } from "../../../../../lib/server";
import { readJsonLimited, JsonBodyTooLargeError, JsonContentTypeError } from "../../../../../lib/api-json";
import {
  netlifyAccount, createNetlifyProject, netlifyHistory, restoreNetlifyDeployment,
  netlifyOAuthConfig, validNetlifyId,
} from "../../../../../lib/netlify-publish";
import { isSiteId } from "../../../../../lib/sites";

export const maxDuration = 30;
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Browser-owned Netlify accounts: the API merely forwards authenticated calls
 * and never persists tokens, site IDs or team selections on the Tsumu server.
 */
export async function POST(req: Request) {
  const denied = await requireAuth("editor");
  if (denied) return denied;
  try { netlifyOAuthConfig(); }
  catch { return NextResponse.json({ error: "Netlify publishing is disabled." }, { status: 503, headers: NO_STORE }); }

  let input: Record<string, unknown>;
  try {
    const value = await readJsonLimited(req, 12 * 1024);
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("Invalid payload");
    input = value as Record<string, unknown>;
  } catch (error) {
    return NextResponse.json({ error: "Invalid Netlify request." }, {
      status: error instanceof JsonBodyTooLargeError ? 413 :
        error instanceof JsonContentTypeError ? 415 : 400, headers: NO_STORE,
    });
  }
  const { token, action, teamId, projectId, deploymentId, target, site, teamSlug } = input;
  if (typeof token !== "string" || token.length < 12 || token.length > 4096) {
    return NextResponse.json({ error: "Netlify authorization is required." }, { status: 401, headers: NO_STORE });
  }
  try {
    if (action === "account") {
      return NextResponse.json(await netlifyAccount(token), { headers: NO_STORE });
    }
    if (action === "create" && isSiteId(site) &&
        (target === "test" || target === "production") && typeof teamSlug === "string") {
      return NextResponse.json(await createNetlifyProject(token, site, target, teamSlug), { headers: NO_STORE });
    }
    if (validNetlifyId(projectId) && validNetlifyId(teamId)) {
      if (action === "history") {
        return NextResponse.json({ deployments: await netlifyHistory(token, projectId, teamId) },
          { headers: NO_STORE });
      }
      if (action === "restore" && validNetlifyId(deploymentId)) {
        await restoreNetlifyDeployment(token, projectId, teamId, deploymentId);
        return NextResponse.json({ ok: true }, { headers: NO_STORE });
      }
    }
    return NextResponse.json({ error: "Invalid Netlify operation." }, { status: 400, headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Netlify operation failed.",
    }, { status: 502, headers: NO_STORE });
  }
}
