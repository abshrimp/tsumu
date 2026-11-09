"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Globe, History, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEditor, docFingerprint } from "../lib/store";
import { buildStaticPublishZip } from "../lib/static-publish-zip";
import { tr } from "../lib/i18n";
import { userMessage } from "../lib/errors";
import { useEscapeToClose } from "../lib/use-escape-to-close";
import { showConfirm } from "../lib/dialog";
import type { PublishTarget } from "../lib/generator";
import { CheckList, docWithSvgFilters } from "./PublishShared";
import {
  confirmStaticRestore,
  StaticDeploymentHistoryView,
  StaticPublishDoneView,
  staticPublishError,
  useStaticPublishChecks,
  yieldBeforeStaticBuild,
  type StaticDeploymentItem,
  type StaticPublishSubmitted,
} from "./StaticPublishShared";
import {
  readNetlifyAccount, saveNetlifyAccount,
  readNetlifySite, saveNetlifySite, saveNetlifyProject, clearNetlifyProject, disconnectNetlifySite,
  readNetlifyOAuthConfig, startNetlifyOAuth, requestNetlify,
  type BrowserNetlifyAccount, type BrowserNetlifySite,
} from "../lib/browser-netlify";

interface NetlifyPublishModalConfig {
  site: string;
  configured: boolean;
  error: string | null;
}

type Team = { id: string; slug: string; name: string };
type RemoteAccount = { user: { id: string; email: string }; teams: Team[] };
type Phase = "loading" | "team" | "check" | "busy" | "done" | "error" | "history";
type NetlifyPublishSubmitted = StaticPublishSubmitted & { projectName?: string };

function netlifyError(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : "";
  if (message === "Netlify OAuth is not configured." || message === "Netlify publishing is disabled." ||
      message === "Configure NETLIFY_OAUTH_CLIENT_ID and NETLIFY_OAUTH_REDIRECT_URI.") {
    return tr("Netlify publishing is not configured. Ask the administrator to check the OAuth settings.");
  }
  if (message === "The registered Netlify callback URL does not match this Tsumu origin.") {
    return tr("The Netlify callback URL does not match this site. Ask the administrator to check it.");
  }
  if (message.startsWith("Browser storage is unavailable.")) {
    return tr("Browser storage is blocked. Allow site data and connect again.");
  }
  if (message.startsWith("Netlify authorization expired") || message === "Netlify authorization is required." ||
      message.startsWith("Netlify authorization expired or does not permit") ||
      message === "Invalid Netlify access token.") {
    return tr("Your Netlify authorization has expired or lacks permission. Connect again.");
  }
  if (message === "You do not have permission to create a site in this Netlify team.") {
    return tr("You do not have permission to create a site in this Netlify team.");
  }
  if (message === "Netlify project was not found." ||
      message === "Netlify project does not belong to the selected team." ||
      message === "Invalid Netlify project.") {
    return tr("The Netlify project was not found. Retry to create a new project.");
  }
  if (message === "Netlify did not return a valid account." || message === "Netlify returned an invalid account.") {
    return tr("Netlify returned an invalid account.");
  }
  if (message === "Netlify request failed (HTTP 429).") {
    return tr("Netlify is temporarily limiting requests. Try again later.");
  }
  if (message.startsWith("Netlify request failed (HTTP ") || message === "Netlify request failed." ||
      message === "Netlify unexpectedly redirected an API request." ||
      message === "Netlify deployment failed." || message === "Netlify operation failed." ||
      message === "Netlify did not return a deployment ID." ||
      message === "Netlify did not return a valid project URL." ||
      message === "Netlify returned a project outside the selected team.") {
    return tr("Netlify could not complete the request. Try again later.");
  }
  return staticPublishError(cause, fallback);
}

export default function NetlifyPublishModal({
  conf, onClose,
}: {
  conf: NetlifyPublishModalConfig;
  onClose: () => void;
}) {
  const doc = useEditor((state) => state.doc);
  const markPublished = useEditor((state) => state.markPublished);
  const [phase, setPhase] = useState<Phase>("loading");
  const [account, setAccount] = useState<BrowserNetlifyAccount | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [binding, setBinding] = useState<BrowserNetlifySite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [target, setTarget] = useState<PublishTarget>("production");
  const [result, setResult] = useState<NetlifyPublishSubmitted | null>(null);
  const [history, setHistory] = useState<StaticDeploymentItem[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const historyRequestRef = useRef(0);
  const loginStartedRef = useRef(false);
  const [connectionAttempt, setConnectionAttempt] = useState(0);

  useEscapeToClose(onClose, phase !== "busy" && !restoring);
  useEffect(() => {
    if (phase !== "history") historyRequestRef.current++;
  }, [phase]);
  const checks = useStaticPublishChecks(doc);
  const blocked = !conf.configured || checks.some((item) => item.level === "error");

  const beginLogin = async () => {
    if (loginStartedRef.current) return;
    loginStartedRef.current = true;
    try {
      const config = await readNetlifyOAuthConfig();
      startNetlifyOAuth(conf.site, config);
    } catch (cause) {
      loginStartedRef.current = false;
      throw cause;
    }
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!conf.configured) {
        if (alive) {
          setError(conf.error || tr("Netlify OAuth is not configured."));
          setPhase("error");
        }
        return;
      }
      try {
        const local = readNetlifyAccount();
        if (!local) {
          await beginLogin();
          return;
        }
        const remote = await requestNetlify<RemoteAccount>({
          action: "account", token: local.token,
        });
        if (!remote.user?.id || !Array.isArray(remote.teams)) {
          throw new Error(tr("Netlify returned an invalid account."));
        }
        const active: BrowserNetlifyAccount = {
          token: local.token, userId: remote.user.id, email: remote.user.email,
        };
        saveNetlifyAccount(active);
        const site = readNetlifySite(conf.site);
        const matched = site?.userId === remote.user.id &&
          remote.teams.some(team => team.id === site.teamId && team.slug === site.teamSlug);
        if (!alive) return;
        setAccount(active);
        setTeams(remote.teams);
        if (matched && site) {
          setBinding(site);
          setPhase("check");
        } else if (remote.teams.length === 1) {
          const team = remote.teams[0];
          const next: BrowserNetlifySite = {
            userId: remote.user.id, teamId: team.id, teamSlug: team.slug,
            production: null, test: null,
          };
          saveNetlifySite(conf.site, next);
          setBinding(next);
          setPhase("check");
        } else {
          setSelectedTeam(remote.teams[0]?.slug || "");
          setPhase("team");
        }
      } catch (cause) {
        if (!alive) return;
        setError(netlifyError(cause, tr("Couldn't connect Netlify.")));
        setPhase("error");
      }
    })();
    return () => { alive = false; };
  // The editor mounts this dialog afresh for each Publish press.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conf.site, conf.configured, connectionAttempt]);

  const chooseTeam = () => {
    if (!account?.userId) return;
    const team = teams.find(entry => entry.slug === selectedTeam);
    if (!team) return;
    try {
      const next: BrowserNetlifySite = {
        userId: account.userId, teamId: team.id, teamSlug: team.slug,
        production: null, test: null,
      };
      saveNetlifySite(conf.site, next);
      setBinding(next);
      setPhase("check");
    } catch (cause) {
      setError(userMessage(cause, tr("Couldn't save Netlify settings.")));
      setPhase("error");
    }
  };

  const publish = async (nextTarget: PublishTarget) => {
    if (blocked || !account || !binding) return;
    setError(null);
    setTarget(nextTarget);
    setPhase("busy");
    setProgress(tr("Generating static site files…"));
    await yieldBeforeStaticBuild();
    try {
      const snapshot = await docWithSvgFilters(doc);
      const zip = await buildStaticPublishZip(snapshot, nextTarget);
      let project = readNetlifySite(conf.site)?.[nextTarget];
      if (!project) {
        setProgress(tr("Creating a project in your Netlify team…"));
        const created = await requestNetlify<{ id: string; url: string; teamId: string }>({
          action: "create", token: account.token, site: conf.site,
          target: nextTarget, teamSlug: binding.teamSlug,
        });
        if (created.teamId !== binding.teamId) {
          throw new Error(tr("The Netlify team changed during publishing."));
        }
        project = { id: created.id, url: created.url };
        // Persist before deploying, so retries update the same remote site.
        saveNetlifyProject(conf.site, nextTarget, project);
        setBinding(readNetlifySite(conf.site));
      }
      setProgress(tr("Uploading site files to {provider}…", { provider: "Netlify" }));
      const response = await fetch("/api/publish/netlify/deploy", {
        method: "POST", cache: "no-store",
        headers: {
          "Content-Type": "application/zip",
          "X-Netlify-Access-Token": account.token,
          "X-Netlify-Project-Id": project.id,
          "X-Netlify-Team-Id": binding.teamId,
        },
        body: zip,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.provider !== "netlify") {
        throw new Error(data?.error || tr("Couldn't publish"));
      }
      if (nextTarget === "production") markPublished(docFingerprint(snapshot));
      setResult(data as NetlifyPublishSubmitted);
      setPhase("done");
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "";
      if (msg === "Netlify project was not found." ||
          msg === "Netlify project does not belong to the selected team." ||
          msg === "Invalid Netlify project.") {
        clearNetlifyProject(conf.site, nextTarget);
        setBinding(readNetlifySite(conf.site));
      }
      setError(netlifyError(cause, tr("Couldn't publish")));
      setPhase("error");
    }
  };

  const openHistory = async (nextTarget: PublishTarget) => {
    const requestId = ++historyRequestRef.current;
    setPhase("history");
    setTarget(nextTarget);
    setHistory(null);
    setError(null);
    if (!account || !binding) return;
    const project = readNetlifySite(conf.site)?.[nextTarget];
    if (!project) { setHistory([]); return; }
    try {
      const data = await requestNetlify<{ deployments: StaticDeploymentItem[] }>({
        action: "history", token: account.token,
        projectId: project.id, teamId: binding.teamId,
      });
      if (historyRequestRef.current !== requestId) return;
      setHistory(data.deployments);
    } catch (cause) {
      if (historyRequestRef.current !== requestId) return;
      setError(netlifyError(cause, tr("Couldn't load publish history")));
    }
  };

  const restore = async (deployment: StaticDeploymentItem) => {
    if (!account || !binding || !deployment.canRestore || restoring) return;
    if (!await confirmStaticRestore()) return;
    const project = readNetlifySite(conf.site)?.[target];
    if (!project) return;
    setRestoring(deployment.id);
    setError(null);
    try {
      await requestNetlify<{ ok: true }>({
        action: "restore", token: account.token, projectId: project.id,
        teamId: binding.teamId, deploymentId: deployment.id,
      });
      await openHistory(target);
    } catch (cause) {
      setError(netlifyError(cause, tr("Couldn't roll back")));
    } finally {
      setRestoring(null);
    }
  };

  const changeTeam = async () => {
    if (!account?.userId) return;
    if (binding && (binding.production || binding.test)) {
      const accepted = await showConfirm(
        tr("Change the Netlify team? Existing published sites will stay online, but new projects will be created in the new team."),
        { title: tr("Change Netlify team"), okLabel: tr("Continue") },
      );
      if (!accepted) return;
    }
    disconnectNetlifySite(conf.site);
    setBinding(null);
    setSelectedTeam(teams[0]?.slug || "");
    setPhase("team");
  };

  const reconnect = async () => {
    setError(null);
    setPhase("loading");
    try {
      // A cancelled sign-in must not discard the previous browser connection.
      await beginLogin();
    } catch (cause) {
      setError(netlifyError(cause, tr("Couldn't connect Netlify.")));
      setPhase("error");
    }
  };

  const retryConnection = () => {
    setError(null);
    setPhase("loading");
    setConnectionAttempt((attempt) => attempt + 1);
  };

  return (
    <div className="modal-backdrop" onClick={phase === "busy" || !!restoring ? undefined : onClose}>
      <div
        className="modal pub-modal netlify-pub-modal"
        role="dialog"
        aria-modal="true"
        aria-label={phase === "history" ? tr("Deployment history") : tr("Publish site")}
        onClick={event => event.stopPropagation()}
      >
        <h2>{phase === "history" ? tr("Deployment history") : tr("Publish site")}</h2>
        {phase === "loading" && (
          <div className="pub-loading" role="status"><LoaderCircle className="spin" size={16} />{tr("Checking Netlify connection…")}</div>
        )}
        {phase === "team" && (
          <>
            <p className="modal-desc">
              {tr("Choose the Netlify team that will pay for and host this site's publications.")}
            </p>
            <label className="home-field">
              <span className="home-field-label">{tr("Netlify team")}</span>
              <select className="input" value={selectedTeam} onChange={event => setSelectedTeam(event.target.value)}>
                {teams.map(team => <option key={team.id} value={team.slug}>{team.name}</option>)}
              </select>
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>{tr("Cancel")}</button>
              <button className="btn btn-primary" disabled={!selectedTeam} onClick={chooseTeam}>
                {tr("Continue to publish")}
              </button>
            </div>
          </>
        )}
        {phase === "check" && (
          <>
            <p className="modal-desc">
              {tr("Publish to your Netlify account. Only generated static files are uploaded, not the editing document.")}
            </p>
            <div className="netlify-account-row">
              <span className="hint netlify-account-identity">
                {account?.email} · {teams.find(team => team.id === binding?.teamId)?.name || binding?.teamSlug}
              </span>
              <div className="netlify-account-controls">
                {teams.length > 1 && (
                  <button className="btn btn-ghost btn-sm" onClick={() => void changeTeam()}>
                    {tr("Change Netlify team")}
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => void reconnect()}>
                  {tr("Switch Netlify account")}
                </button>
              </div>
            </div>
            <CheckList checks={checks} onClose={onClose} />
            <div className="pub-cards">
              {(["test", "production"] as const).map(item => {
                const project = binding?.[item];
                return (
                  <section key={item} className={"pub-card" + (item === "production" ? " is-prod" : "")}>
                    <header>
                      <span className="pub-card-icon"><Globe size={15} /></span>
                      <div><strong>{item === "production" ? tr("Live site") : tr("Test site")}</strong>
                        <p>Netlify</p></div>
                    </header>
                    <div className="pub-card-meta">
                      {project ? (
                        <a className="pub-meta-row" href={project.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink size={12}/><span className="pub-meta-text">{project.url}</span>
                        </a>
                      ) : <span className="hint">{tr("A new Netlify project will be created at first publish.")}</span>}
                    </div>
                    <button className={item === "production" ? "btn btn-primary" : "btn"} disabled={blocked}
                      onClick={() => void publish(item)}>
                      {item === "production" ? tr("Publish to live") : tr("Publish to test")}
                    </button>
                  </section>
                );
              })}
            </div>
            <div className="modal-actions pub-actions">
              <button className="btn btn-ghost" onClick={() => void openHistory("production")}>
                <History size={13}/>{tr("Deployment history")}
              </button>
              <button className="btn" onClick={onClose}>{tr("Close")}</button>
            </div>
          </>
        )}
        {phase === "busy" && <div className="pub-loading is-large">
          <LoaderCircle className="spin" size={16}/>{progress}
        </div>}
        {phase === "done" && result && (
          <StaticPublishDoneView
            providerName="Netlify"
            result={result}
            onClose={onClose}
            visibilitySettingsUrl={result.projectName && /^[a-z0-9][a-z0-9-]{0,62}$/.test(result.projectName)
              ? `https://app.netlify.com/projects/${encodeURIComponent(result.projectName)}/configuration/general#visitor-access`
              : undefined}
          />
        )}
        {phase === "error" && (
          <>
            <div className="netlify-pub-error" role="alert">
              <TriangleAlert size={18} aria-hidden="true" />
              <p>{error}</p>
            </div>
            <div className="modal-actions netlify-pub-error-actions">
              <button className="btn" onClick={onClose}>{tr("Close")}</button>
              {account && binding ? (
                <>
                  <button className="btn" onClick={() => setPhase("check")}>{tr("Back")}</button>
                  <button className="btn btn-primary" onClick={() => void publish(target)}>{tr("Retry")}</button>
                </>
              ) : (
                <>
                  {readNetlifyAccount() && (
                    <button className="btn" onClick={retryConnection}>{tr("Retry")}</button>
                  )}
                  <button className="btn btn-primary" onClick={() => void reconnect()}>{tr("Connect Netlify")}</button>
                </>
              )}
            </div>
          </>
        )}
        {phase === "history" && (
          <StaticDeploymentHistoryView
            description={tr("Netlify keeps deployment history. Editing data remains in your browser.")}
            target={target}
            onTargetChange={(next) => void openHistory(next)}
            history={history}
            error={error}
            restoring={restoring}
            onRestore={(entry) => void restore(entry)}
            onBack={() => setPhase("check")}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}
