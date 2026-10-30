import { getDb } from "./db";
import { hostingProjectName } from "./publish-provider";
import {
  boundNetlifyCredential, getNetlifyBinding, netlifyApi,
  saveNetlifyProjectId, type NetlifyBinding,
} from "./netlify-account";
import type { PublishTarget } from "./generator";
import type { StaticDeployment, StaticDeploymentHistory } from "./static-hosting";

type RemoteSite = {
  id?: string;
  name?: string;
  account_id?: string;
  ssl_url?: string;
  url?: string;
};
type RemoteDeploy = {
  id?: string; state?: string; created_at?: string;
  deploy_ssl_url?: string; ssl_url?: string;
};

function siteIdFor(binding: NetlifyBinding, target: PublishTarget): string | null {
  return target === "test" ? binding.previewSiteId : binding.productionSiteId;
}

/**
 * Always resolve the remote project by the pinned API site ID and verify its
 * team. Never infer an existing project from an untrusted project name.
 */
async function projectFor(siteId: string, target: PublishTarget, create: boolean): Promise<{
  id: string; token: string; url: string;
} | null> {
  const db = await getDb();
  const owner = await boundNetlifyCredential(db, siteId);
  if (!owner) throw new Error("Connect Netlify and select a team in the site's settings.");
  const { binding, token } = owner;
  let id = siteIdFor(binding, target);
  if (!id && !create) return null;
  let site: RemoteSite;
  if (!id) {
    const prefix = hostingProjectName(siteId, "netlify", target);
    const name = prefix + "-" + crypto.randomUUID().slice(0, 6);
    if (name.length > 63) throw new Error("The Netlify project name is too long.");
    site = await netlifyApi<RemoteSite>(token,
      "/" + encodeURIComponent(binding.teamSlug) + "/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    if (!site.id || site.account_id !== binding.teamId) {
      throw new Error("Netlify returned a project outside the selected team.");
    }
    const url = site.ssl_url || "https://" + name + ".netlify.app";
    await saveNetlifyProjectId(db, binding, target, site.id, url);
    id = site.id;
  } else {
    site = await netlifyApi<RemoteSite>(token, "/sites/" + encodeURIComponent(id));
    if (site.id !== id || site.account_id !== binding.teamId) {
      throw new Error("Netlify project ownership changed. Reconnect the project in Site settings.");
    }
  }
  return { id, token, url: site.ssl_url || site.url || "https://" + site.name + ".netlify.app" };
}

export async function deployNetlify(siteId: string, target: PublishTarget, raw: ArrayBuffer): Promise<StaticDeployment> {
  const project = await projectFor(siteId, target, true);
  if (!project) throw new Error("The Netlify project is not configured.");
  const data = await netlifyApi<RemoteDeploy>(project.token,
    "/sites/" + encodeURIComponent(project.id) + "/deploys", {
      method: "POST", headers: { "Content-Type": "application/zip" }, body: raw,
    });
  if (!data.id) throw new Error("Netlify did not return a deployment ID.");
  return {
    id: data.id,
    url: data.deploy_ssl_url || data.ssl_url || project.url,
    state: data.state || "processing",
  };
}

export async function listNetlifyDeployments(
  siteId: string, target: PublishTarget,
): Promise<StaticDeploymentHistory[]> {
  const project = await projectFor(siteId, target, false);
  if (!project) return [];
  const data = await netlifyApi<RemoteDeploy[]>(project.token,
    "/sites/" + encodeURIComponent(project.id) + "/deploys?per_page=25");
  if (!Array.isArray(data)) throw new Error("Netlify did not return deployment history.");
  return data.filter((entry) => !!entry.id).map((entry) => ({
    id: entry.id!,
    date: entry.created_at || "",
    state: entry.state || "unknown",
    url: entry.deploy_ssl_url || entry.ssl_url || project.url,
    canRestore: entry.state === "ready",
  }));
}

export async function restoreNetlifyDeployment(
  siteId: string, target: PublishTarget, deploymentId: string,
): Promise<void> {
  const history = await listNetlifyDeployments(siteId, target);
  if (!history.some((deployment) => deployment.id === deploymentId && deployment.canRestore)) {
    throw new Error("This deployment cannot be restored.");
  }
  const project = await projectFor(siteId, target, false);
  if (!project) throw new Error("The Netlify project does not exist.");
  await netlifyApi<unknown>(project.token,
    "/sites/" + encodeURIComponent(project.id) + "/deploys/" +
    encodeURIComponent(deploymentId) + "/restore", { method: "POST" });
}

export async function netlifyProjectStatus(siteId: string): Promise<{
  bound: boolean; connected: boolean;
  productionProject: string | null; previewProject: string | null;
  productionUrl: string | null; previewUrl: string | null;
}> {
  const db = await getDb();
  const binding = await getNetlifyBinding(db, siteId);
  if (!binding) return {
    bound: false, connected: false, productionProject: null, previewProject: null,
    productionUrl: null, previewUrl: null,
  };
  // Status never sends the decrypted token or Netlify user identity to the browser.
  const owner = await boundNetlifyCredential(db, siteId);
  return {
    bound: true, connected: !!owner,
    productionProject: binding.productionSiteId,
    previewProject: binding.previewSiteId,
    productionUrl: binding.productionUrl,
    previewUrl: binding.previewUrl,
  };
}
