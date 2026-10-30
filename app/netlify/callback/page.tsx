"use client";

import { useEffect, useState } from "react";
import { tr } from "../../../lib/i18n";

export default function NetlifyCallback() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    // OAuth implicit response arrives in the URL fragment. Remove it BEFORE
    // any API request or rendering the response. Never log or persist this token.
    const fragment = window.location.hash;
    window.history.replaceState(null, "", window.location.pathname);
    const params = new URLSearchParams(fragment.replace(/^#/, ""));
    const token = params.get("access_token");
    const state = params.get("state");
    const oauthError = params.get("error");
    if (oauthError || !token || !state) {
      setError(oauthError === "access_denied" ? tr("Netlify access was not granted.")
        : tr("The Netlify sign-in response was invalid. Please try connecting again."));
      return;
    }
    void (async () => {
      try {
        const response = await fetch("/api/publish/netlify/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state, accessToken: token }),
          credentials: "same-origin",
          cache: "no-store",
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok || typeof data.siteId !== "string") {
          throw new Error(data?.error ?? tr("Could not connect Netlify."));
        }
        if (!cancelled) window.location.replace("/sites/" + encodeURIComponent(data.siteId) + "?publish=1");
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : tr("Could not connect Netlify."));
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return (
    <main style={{ maxWidth: 480, margin: "12vh auto", padding: 24 }}>
      <h1>{tr("Connect Netlify")}</h1>
      {error ? <p role="alert">{error}</p> : <p role="status">{tr("Finishing Netlify authorization…")}</p>}
      <a href="/">{tr("Return to sites")}</a>
    </main>
  );
}
