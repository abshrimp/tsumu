import { envVar } from "./env";
import type { PublishTarget } from "./generator";
import { isSiteId } from "./sites";

export type PublishProvider = "github" | "netlify" | "cloudflare";
export type StaticPublishProvider = Exclude<PublishProvider, "github">;

/** This setting belongs to the Tsumu server, never to a site's editable document. */
export function publishProvider(): PublishProvider {
  const value = envVar("PUBLISH_PROVIDER") || "github";
  if (value === "github" || value === "netlify" || value === "cloudflare") return value;
  throw new Error("PUBLISH_PROVIDER must be github, netlify or cloudflare.");
}

/**
 * Every Tsumu site gets its own hosting project. Site IDs are random and generated
 * by Tsumu; no user-supplied hosting project ID is accepted by the deployment API.
 * Netlify uses a separate project for previews so a preview never replaces production.
 */
export function hostingProjectName(
  siteId: string,
  provider: StaticPublishProvider,
  target: PublishTarget,
  prefix: string = envVar("PUBLISH_PROJECT_PREFIX") || "tsumu",
): string {
  if (!isSiteId(siteId) || !/^[a-z][a-z0-9-]{0,19}$/.test(prefix) || prefix.endsWith("-")) {
    throw new Error("Invalid site ID or PUBLISH_PROJECT_PREFIX.");
  }
  const project = prefix + "-" + siteId + (provider === "netlify" && target === "test" ? "-preview" : "");
  if (project.length > 63) throw new Error("The hosting project name is too long.");
  return project;
}

export interface StaticPublishConfig {
  provider: StaticPublishProvider;
  project: string;
  previewProject: string;
  configured: boolean;
  error: string | null;
  productionUrl: string;
  previewUrl: string;
}

export function staticPublishConfig(siteId: string): StaticPublishConfig {
  const provider = publishProvider();
  if (provider === "github") throw new Error("Static publishing is not selected.");
  const project = hostingProjectName(siteId, provider, "production");
  const previewProject = hostingProjectName(siteId, provider, "test");
  const configured = provider === "netlify"
    ? !!envVar("NETLIFY_OAUTH_CLIENT_ID") && !!envVar("NETLIFY_OAUTH_REDIRECT_URI")
    : !!envVar("CLOUDFLARE_ACCOUNT_ID") && !!envVar("CLOUDFLARE_API_TOKEN");
  return {
    provider,
    project,
    previewProject,
    configured,
    error: configured ? null : provider === "netlify"
      ? "Netlify OAuth is not configured on the server."
      : "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required on the server.",
    productionUrl: provider === "netlify" ? "https://" + project + ".netlify.app"
      : "https://" + project + ".pages.dev",
    previewUrl: provider === "netlify" ? "https://" + previewProject + ".netlify.app"
      : "https://tsumu-preview." + project + ".pages.dev",
  };
}
