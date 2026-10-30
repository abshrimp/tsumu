"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Globe, History, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import { docFingerprint, useEditor } from "../lib/store";
import { exportLimitations } from "../lib/export-formats";
import { runChecks, type CheckResult } from "../lib/generator/checks";
import { buildStaticPublishZip } from "../lib/static-publish-zip";
import { useEscapeToClose } from "../lib/use-escape-to-close";
import { tr } from "../lib/i18n";
import { userMessage } from "../lib/errors";
import { showConfirm } from "../lib/dialog";
import type { PublishTarget } from "../lib/generator";
import type { StaticPublishProvider } from "../lib/publish-provider";
import { CheckList, docWithSvgFilters } from "./PublishShared";

interface Target {
  project: string;
  url: string | null;
  error: string | null;
}

export interface StaticPublishModalConfig {
  provider: StaticPublishProvider;
  site: string;
  configured: boolean;
  test: Target;
  production: Target;
}

interface PublishResult {
  id: string;
  state: string;
  deploymentUrl: string;
  siteUrl: string;
  provider: StaticPublishProvider;
}

interface Deployment {
  id: string;
  date: string;
  url: string;
  state: string;
  canRestore: boolean;
}

function providerLabel(provider: StaticPublishProvider): string {
  return provider === "netlify" ? "Netlify" : "Cloudflare Pages";
}

function StaticPublishContent({
  conf,
  onClose,
}: {
  conf: StaticPublishModalConfig;
  onClose: () => void;
}) {
  const doc = useEditor((state) => state.doc);
  const markPublished = useEditor((state) => state.markPublished);
  const [phase, setPhase] = useState<"check" | "busy" | "done" | "error">("check");
  const [target, setTarget] = useState<PublishTarget>("production");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<PublishTarget>("production");
  const [history, setHistory] = useState<Deployment[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEscapeToClose(onClose, phase !== "busy" && !restoring);
  const checks = useMemo<CheckResult[]>(() => [
    ...runChecks(doc),
    ...exportLimitations(doc, {
      framework: "html", language: "javascript", style: "css", scope: "project",
    }).map((message): CheckResult => ({ level: "error", message })),
  ], [doc]);
  const blocked = !conf.configured || checks.some((item) => item.level === "error");
  const providerName = providerLabel(conf.provider);

  const loadHistory = useCallback(async (nextTarget: PublishTarget) => {
    setHistory(null);
    setHistoryError(null);
    const params = new URLSearchParams({
      site: conf.site,
      target: nextTarget,
      provider: conf.provider,
    });
    try {
      const response = await fetch("/api/publish/static/history?" + params);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? tr("Couldn't load publish history"));
      if (data.provider !== conf.provider) throw new Error(tr("The publishing provider changed. Reopen this dialog."));
      setHistory(data.deployments as Deployment[]);
    } catch (cause) {
      setHistoryError(userMessage(cause, tr("Couldn't load publish history")));
    }
  }, [conf.site, conf.provider]);

  useEffect(() => {
    if (historyOpen) void loadHistory(historyTarget);
  }, [historyOpen, historyTarget, loadHistory]);

  const publish = async (nextTarget: PublishTarget) => {
    if (blocked) return;
    setTarget(nextTarget);
    setPhase("busy");
    setError(null);
    setProgress(tr("Generating static site files…"));
    if (typeof window.requestAnimationFrame === "function") {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)));
    }
    try {
      // Use one snapshot even when someone edits the document during an upload.
      const snapshot = await docWithSvgFilters(doc);
      const archive = await buildStaticPublishZip(snapshot, nextTarget);
      setProgress(tr("Uploading site files to {provider}…", { provider: providerName }));
      const params = new URLSearchParams({
        site: conf.site,
        target: nextTarget,
        provider: conf.provider,
        project: conf[nextTarget].project,
      });
      const response = await fetch("/api/publish/static?" + params, {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: archive,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? tr("Couldn't publish"));
      if (data.provider !== conf.provider) throw new Error(tr("The publishing provider changed. Reopen this dialog."));
      if (nextTarget === "production") markPublished(docFingerprint(snapshot));
      setResult(data as PublishResult);
      setPhase("done");
    } catch (cause) {
      setError(userMessage(cause, tr("Couldn't publish")));
      setPhase("error");
    }
  };

  const restore = async (item: Deployment) => {
    if (!item.canRestore || restoring) return;
    const accepted = await showConfirm(
      tr("Restore this deployment to the selected site? The live content will change."),
      { title: tr("Restore deployment"), okLabel: tr("Restore this version"), danger: true }
    );
    if (!accepted) return;
    setRestoring(item.id);
    try {
      const response = await fetch("/api/publish/static/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site: conf.site, target: historyTarget, provider: conf.provider,
          deploymentId: item.id,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? tr("Couldn't roll back"));
      await loadHistory(historyTarget);
    } catch (cause) {
      setHistoryError(userMessage(cause, tr("Couldn't roll back")));
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={phase === "busy" || restoring ? undefined : onClose}>
      <div className="modal pub-modal" onClick={(event) => event.stopPropagation()}>
        <h2>{historyOpen ? tr("Deployment history") : tr("Publish site")}</h2>
        {historyOpen ? (
          <>
            <p className="modal-desc">
              {tr("Deployment history is stored by {provider}. Static hosting does not publish the editor document.", { provider: providerName })}
            </p>
            <div className="seg-group">
              <button className={"seg" + (historyTarget === "production" ? " active" : "")}
                onClick={() => setHistoryTarget("production")}>{tr("Live site")}</button>
              <button className={"seg" + (historyTarget === "test" ? " active" : "")}
                onClick={() => setHistoryTarget("test")}>{tr("Test site")}</button>
            </div>
            {history === null && !historyError && (
              <div className="pub-loading"><LoaderCircle className="spin" size={14} />{tr("Loading…")}</div>
            )}
            {historyError && <p className="pub-card-error" role="alert">{historyError}</p>}
            {history?.length === 0 && <p className="hint">{tr("Not published yet.")}</p>}
            {history && (
              <div className="hist-list">
                {history.map((item) => (
                  <div className="hist-item" key={item.id}>
                    <div>
                      <a href={item.url} target="_blank" rel="noopener noreferrer">
                        {item.date ? new Date(item.date).toLocaleString() : item.id}
                      </a>
                      <p className="hint">{item.state}</p>
                    </div>
                    {item.canRestore && (
                      <button className="btn btn-sm" onClick={() => void restore(item)}
                        disabled={!!restoring}>
                        <RotateCcw size={13} />
                        {restoring === item.id ? tr("Restoring…") : tr("Restore this version")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => setHistoryOpen(false)} disabled={!!restoring}>{tr("Back")}</button>
              <button className="btn" onClick={onClose} disabled={!!restoring}>{tr("Close")}</button>
            </div>
          </>
        ) : (
          <>
            {phase === "check" && (
              <>
                <p className="modal-desc">
                  {tr("Publish generated HTML, CSS, JavaScript and assets directly to {provider}. Editable project data is not uploaded.", { provider: providerName })}
                </p>
                <p className="hint export-note">
                  {tr("The hosting provider is chosen by the server administrator. Configure custom domains in the hosting service.")}
                </p>
                {!conf.configured && (
                  <>
                    <p className="pub-card-error" role="alert">
                      {conf.production.error ?? tr("Static publishing isn't configured on the server.")}
                    </p>
                    {conf.provider === "netlify" && (
                      <a className="btn btn-sm" href={"/?settings=" + encodeURIComponent(conf.site)}>
                        {tr("Open site settings to connect Netlify")}
                      </a>
                    )}
                  </>
                )}
                <CheckList checks={checks} onClose={onClose} />
                <div className="pub-cards">
                  {(["test", "production"] as const).map((item) => (
                    <section key={item} className={"pub-card" + (item === "production" ? " is-prod" : "")}>
                      <header>
                        <span className="pub-card-icon"><Globe size={15} /></span>
                        <div>
                          <strong>{item === "production" ? tr("Live site") : tr("Test site")}</strong>
                          <p>{providerName}</p>
                        </div>
                      </header>
                      <div className="pub-card-meta">
                        <span className="pub-meta-row mono"><span className="pub-meta-text">{conf[item].project}</span></span>
                        {conf[item].url && (
                          <a href={conf[item].url!} className="pub-meta-row" target="_blank" rel="noopener noreferrer">
                            <ExternalLink size={12} /><span className="pub-meta-text">{conf[item].url}</span>
                          </a>
                        )}
                      </div>
                      <button className={item === "production" ? "btn btn-primary" : "btn"}
                        disabled={blocked || !!conf[item].error}
                        onClick={() => void publish(item)}>
                        {item === "production" ? tr("Publish to live") : tr("Publish to test")}
                      </button>
                    </section>
                  ))}
                </div>
                <div className="modal-actions pub-actions">
                  <button className="btn btn-ghost" onClick={() => setHistoryOpen(true)}
                    disabled={!conf.configured}>
                    <History size={13} />{tr("Deployment history")}
                  </button>
                  <button className="btn" onClick={onClose}>{tr("Close")}</button>
                </div>
              </>
            )}
            {phase === "busy" && (
              <div className="pub-loading is-large">
                <LoaderCircle size={16} className="spin" />{progress}
              </div>
            )}
            {phase === "done" && result && (
              <>
                <div className="check-ok"><Check size={14} />{tr("Deployment submitted to {provider}.", { provider: providerName })}</div>
                <p className="hint">{tr("Deployment status: {state}", { state: result.state })}</p>
                <div className="modal-actions">
                  <a className="btn" href={result.deploymentUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={13} />{tr("View deployment")}
                  </a>
                  <a className="btn" href={result.siteUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={13} />{tr("Open site")}
                  </a>
                  <button className="btn btn-primary" onClick={onClose}>{tr("Close")}</button>
                </div>
              </>
            )}
            {phase === "error" && (
              <>
                <ul className="check-list"><li className="is-error">
                  <TriangleAlert size={14}/>{error}
                </li></ul>
                <div className="modal-actions">
                  <button className="btn" onClick={() => setPhase("check")}>{tr("Back")}</button>
                  <button className="btn btn-primary" onClick={() => void publish(target)}>{tr("Retry")}</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}


type NetlifySetup = {
  connected: boolean;
  teams: { id: string; slug: string; name: string }[];
  binding: { teamSlug: string; teamName: string; ownerIsYou: boolean } | null;
};

/** Entry point: users can connect and choose their own Netlify account from Publish. */
export default function StaticPublishModal({
  conf,
  onClose,
}: {
  conf: StaticPublishModalConfig;
  onClose: () => void;
}) {
  const [active, setActive] = useState(conf);
  const [setup, setSetup] = useState<NetlifySetup | null>(null);
  const [loading, setLoading] = useState(conf.provider === "netlify" && !conf.configured);
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  useEscapeToClose(onClose, !busy);

  useEffect(() => {
    if (conf.provider !== "netlify" || active.configured) return;
    let alive = true;
    void (async () => {
      try {
        const response = await fetch("/api/publish/netlify?site=" + encodeURIComponent(conf.site), {
          cache: "no-store",
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || tr("Ask the site owner to connect Netlify."));
        if (!alive) return;
        setSetup(data as NetlifySetup);
        setTeam(data.binding?.teamSlug || data.teams?.[0]?.slug || "");
        // Clicking Publish initiates the Netlify login itself for disconnected owners.
        if (!data.connected) {
          window.location.assign("/api/publish/netlify/authorize?site=" + encodeURIComponent(conf.site));
          return;
        }
        if (data.binding && active.production.error?.includes("disconnected")) {
          setSetupError(tr("Reconnect Netlify to publish this site."));
        }
      } catch (cause) {
        if (alive) setSetupError(cause instanceof Error ? cause.message : tr("Could not load Netlify settings."));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [conf.provider, conf.site, active.configured, active.production.error]);

  const bindTeam = async (slug: string) => {
    if (!slug || busy) return;
    setBusy(true);
    setSetupError(null);
    try {
      const response = await fetch("/api/publish/netlify?site=" + encodeURIComponent(conf.site), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "team", teamSlug: slug }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || tr("Could not select a Netlify team."));
      // Refresh only publish configuration: preserve in-progress edits in the editor.
      const refreshed = await fetch("/api/publish?site=" + encodeURIComponent(conf.site), { cache: "no-store" });
      const next = await refreshed.json().catch(() => null);
      if (!refreshed.ok || next?.provider !== "netlify" || !next?.configured) {
        throw new Error(next?.production?.error || tr("Could not load Netlify publishing configuration."));
      }
      setActive({
        site: conf.site, provider: "netlify", configured: true,
        test: next.test, production: next.production,
      });
    } catch (cause) {
      setSetupError(cause instanceof Error ? cause.message : tr("Could not select a Netlify team."));
    } finally {
      setBusy(false);
    }
  };

  if (active.provider !== "netlify" || active.configured) {
    return <StaticPublishContent conf={active} onClose={onClose} />;
  }
  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal pub-modal" onClick={(event) => event.stopPropagation()}>
        <h2>{tr("Publish site")}</h2>
        <p className="modal-desc">
          {tr("Publish this site to your own Netlify account. Netlify usage is charged to the selected team.")}
        </p>
        {loading && <div className="pub-loading" role="status">
          <LoaderCircle size={15} className="spin" />{tr("Checking Netlify connection…")}
        </div>}
        {!loading && setup?.connected && (
          <>
            <p className="hint">
              {tr("Choose the Netlify team that will own this site's publication.")}
            </p>
            <label className="home-field">
              <span className="home-field-label">{tr("Netlify team")}</span>
              <select className="input" value={team} disabled={busy}
                onChange={(event) => setTeam(event.target.value)}>
                {setup.teams.map((option) => (
                  <option key={option.id} value={option.slug}>{option.name}</option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-primary" disabled={!team || busy}
              onClick={() => void bindTeam(team)}>
              {busy && <LoaderCircle size={13} className="spin" />}
              {tr("Continue to publish")}
            </button>
          </>
        )}
        {!loading && !setup?.connected && (
          <a className="btn btn-primary" href={"/api/publish/netlify/authorize?site=" + encodeURIComponent(conf.site)}>
            {tr("Log in to Netlify")}
          </a>
        )}
        {setupError && <p className="pub-card-error" role="alert">{setupError}</p>}
        <div className="modal-actions">
          <button className="btn" disabled={busy} onClick={onClose}>{tr("Cancel")}</button>
        </div>
      </div>
    </div>
  );
}
