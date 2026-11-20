"use client";

import { useEffect } from "react";
import { loadLocalSites } from "../../../lib/site";
import { isSiteId, type SiteRecord } from "../../../lib/site-model";
import { OFFICIAL_MCP_ORIGIN, isOfficialEditorOrigin } from "../../../lib/external-edit/official.mjs";

const NONCE_RE = /^#nonce=([A-Za-z0-9_-]{22,64})$/;
type DirectorySite = { id: string; name: string; canEdit: boolean };

/**
 * Same-site bridge for the official OAuth page.
 * No cookies, secrets, or documents cross the subdomain boundary: only
 * site names, IDs and read/edit eligibility are posted to the exact parent.
 * All actual access still requires user selection and an OAuth pairing code.
 */
export default function McpSitesBridge() {
  useEffect(() => {
    if (window.parent === window || !isOfficialEditorOrigin(window.location.origin)) return;
    const nonce = NONCE_RE.exec(window.location.hash)?.[1];
    if (!nonce) return;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    let cancelled = false;

    void (async () => {
      let sites: DirectorySite[] = [];
      let unavailable = false;
      try {
        const res = await fetch("/api/sites", { cache: "no-store" });
        let list: SiteRecord[];
        if (res.status === 503) {
          list = loadLocalSites();
        } else if (res.ok) {
          const body: unknown = await res.json();
          if (!body || typeof body !== "object" || !("sites" in body) ||
              !Array.isArray(body.sites)) throw new Error("Invalid sites response");
          list = body.sites as SiteRecord[];
        } else {
          throw new Error("Cannot load site list");
        }
        sites = list.filter(site =>
          site && isSiteId(site.id) && typeof site.name === "string"
        ).slice(0, 200).map(site => ({
          id: site.id,
          name: site.name.slice(0, 120),
          canEdit: site.accessRole !== "viewer",
        }));
      } catch {
        unavailable = true;
      }
      if (!cancelled) {
        window.parent.postMessage({
          type: "tsumu-mcp-sites", nonce, sites, unavailable,
        }, OFFICIAL_MCP_ORIGIN);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // No clickable UI is exposed in the frame.
  return null;
}
