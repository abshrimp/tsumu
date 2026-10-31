"use client";

import { useEffect, useRef, useState } from "react";
import { tr } from "../../../lib/i18n";
import { finishNetlifyOAuth } from "../../../lib/browser-netlify";

export default function NetlifyCallback() {
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    // The implicit OAuth access token arrives in the fragment. Strip it from
    // the address bar synchronously, before doing anything else with the token.
    const fragment = window.location.hash;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    const params = new URLSearchParams(fragment.replace(/^#/, ""));
    const token = params.get("access_token");
    const state = params.get("state");
    if (params.get("error") || !token || !state) {
      setError(params.get("error") === "access_denied"
        ? tr("Netlify access was not granted.")
        : tr("The Netlify sign-in response was invalid. Please try connecting again."));
      return;
    }
    try {
      const siteId = finishNetlifyOAuth(state, token);
      window.location.replace("/sites/" + encodeURIComponent(siteId) + "?publish=1");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr("Could not connect Netlify."));
    }
  }, []);

  return (
    <main style={{ maxWidth: 480, margin: "12vh auto", padding: 24 }}>
      <h1>{tr("Connect Netlify")}</h1>
      {error ? <p role="alert">{error}</p>
        : <p role="status">{tr("Finishing Netlify authorization…")}</p>}
      <a href="/">{tr("Return to sites")}</a>
    </main>
  );
}
