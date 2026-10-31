import { NextResponse } from "next/server";
import { requireAuth } from "../../../../../lib/server";
import { netlifyOAuthConfig, deployNetlifyZip, validNetlifyId } from "../../../../../lib/netlify-publish";
import { readStaticZip, readZipRequest } from "../../../../../lib/static-hosting";

export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(req: Request) {
  const denied = await requireAuth("editor");
  if (denied) return denied;
  try { netlifyOAuthConfig(); }
  catch { return NextResponse.json({ error: "Netlify publishing is disabled." }, { status: 503, headers: NO_STORE }); }

  const accessToken = req.headers.get("x-netlify-access-token");
  const projectId = req.headers.get("x-netlify-project-id");
  const teamId = req.headers.get("x-netlify-team-id");
  if (!accessToken || accessToken.length < 12 || accessToken.length > 4096 ||
      !validNetlifyId(projectId) || !validNetlifyId(teamId)) {
    return NextResponse.json({ error: "Netlify account or project is not configured." },
      { status: 400, headers: NO_STORE });
  }
  try {
    const zip = await readZipRequest(req);
    await readStaticZip(zip); // Refuse unsafe paths, secrets and ZIP bombs before contacting Netlify.
    const deployment = await deployNetlifyZip(accessToken, projectId, teamId, zip);
    return NextResponse.json({
      provider: "netlify", id: deployment.id, state: deployment.state,
      deploymentUrl: deployment.url, siteUrl: deployment.siteUrl,
    }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Netlify deployment failed." },
      { status: 502, headers: NO_STORE });
  }
}
