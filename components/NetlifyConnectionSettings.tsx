"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { tr } from "../lib/i18n";
import { showConfirm } from "../lib/dialog";

type Team = { id: string; slug: string; name: string };
type Status = {
  connected: boolean;
  netlifyEmail: string | null;
  teams: Team[];
  binding: {
    teamSlug: string; teamName: string; ownerIsYou: boolean;
    published: boolean; productionUrl: string | null; previewUrl: string | null;
  } | null;
};

/** Only owners may configure a site's Netlify team. Editor members only deploy. */
export default function NetlifyConnectionSettings({ siteId }: { siteId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [team, setTeam] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = "/api/publish/netlify?site=" + encodeURIComponent(siteId);
  const load = useCallback(async () => {
    try {
      const response = await fetch(url, { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || tr("Could not load Netlify settings."));
      setStatus(data as Status);
      setTeam(data.binding?.ownerIsYou ? data.binding.teamSlug : data.teams?.[0]?.slug || "");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr("Could not load Netlify settings."));
    }
  }, [url]);

  useEffect(() => { void load(); }, [load]);

  const request = async (method: "POST" | "DELETE", action?: object) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        ...(action ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) } : {}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || tr("Could not save Netlify settings."));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr("Could not save Netlify settings."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="home-set-sec" aria-label={tr("Netlify connection")}>
      <h3>{tr("Netlify connection")}</h3>
      <p className="home-field-hint">
        {tr("Connect your own Netlify account. Each Tsumu site's deployments use its owner's selected Netlify team.")}
      </p>
      {!status && !error && <p className="hint"><LoaderCircle size={13} className="spin" />{tr("Loading…")}</p>}
      {status && (
        <>
          {status.connected ? (
            <>
              <p className="hint">{tr("Connected as {email}", { email: status.netlifyEmail || "" })}</p>
              <div className="home-field">
                <span className="home-field-label">{tr("Netlify team")}</span>
                <select
                  className="input"
                  value={team}
                  onChange={(event) => setTeam(event.target.value)}
                  disabled={busy || (status.binding?.published && status.binding.ownerIsYou)}
                >
                  {status.teams.map((option) => (
                    <option key={option.id} value={option.slug}>{option.name}</option>
                  ))}
                </select>
                <span className="home-field-hint">
                  {tr("Netlify usage and billing belong to the selected team, not Tsumu.")}
                </span>
              </div>
              <div className="modal-actions">
                <button className="btn btn-primary" type="button" disabled={busy || !team ||
                    !!(status.binding?.published && status.binding.ownerIsYou)}
                  onClick={() => void request("POST", { action: "team", teamSlug: team })}>
                  {tr("Use this Netlify team")}
                </button>
                <a className="btn" href={"/api/publish/netlify/authorize?site=" + encodeURIComponent(siteId)}>
                  {tr("Reconnect Netlify")}
                </a>
              </div>
            </>
          ) : (
            <a className="btn btn-primary" href={"/api/publish/netlify/authorize?site=" + encodeURIComponent(siteId)}>
              <ExternalLink size={14}/>{tr("Connect Netlify")}
            </a>
          )}
          {status.binding && (
            <>
              <p className="hint">
                {tr("Site hosting team: {team}", { team: status.binding.teamName })}
                {status.binding.published ? " · " + tr("Published") : ""}
              </p>
              {status.binding.productionUrl && (
                <p><a target="_blank" rel="noopener noreferrer" href={status.binding.productionUrl}>
                  {status.binding.productionUrl}
                </a></p>
              )}
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void (async () => {
                if (await showConfirm(
                  tr("Disconnect this site's Netlify projects? Existing hosted websites will remain online, but a new publication will create a new Netlify project."),
                  { title: tr("Disconnect site hosting"), okLabel: tr("Disconnect") },
                )) await request("POST", { action: "unbind" });
              })()}>
                {tr("Disconnect site hosting")}
              </button>
            </>
          )}
          {status.connected && (
            <div>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void (async () => {
                if (await showConfirm(
                  tr("Disconnect your Netlify account from Tsumu? All your connected sites will stop publishing until you reconnect. Hosted sites will remain online."),
                  { title: tr("Disconnect Netlify account"), okLabel: tr("Disconnect") },
                )) await request("DELETE");
              })()}>
                {tr("Disconnect Netlify account")}
              </button>
            </div>
          )}
        </>
      )}
      {error && <p className="home-dialog-error" role="alert">{error}</p>}
    </section>
  );
}
