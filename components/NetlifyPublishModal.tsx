"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, Globe, History, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import { useEditor, docFingerprint } from "../lib/store";
import { exportLimitations } from "../lib/export-formats";
import { runChecks, type CheckResult } from "../lib/generator/checks";
import { buildStaticPublishZip } from "../lib/static-publish-zip";
import { tr } from "../lib/i18n";
import { userMessage } from "../lib/errors";
import { useEscapeToClose } from "../lib/use-escape-to-close";
import { showConfirm } from "../lib/dialog";
import type { PublishTarget } from "../lib/generator";
import type { StaticPublishModalConfig } from "./StaticPublishModal";
import { Seg } from "./controls";
import { CheckList, docWithSvgFilters } from "./PublishShared";
import {
  readNetlifyAccount, saveNetlifyAccount, disconnectNetlifyAccount,
  readNetlifySite, saveNetlifySite, saveNetlifyProject, disconnectNetlifySite,
  readNetlifyOAuthConfig, startNetlifyOAuth, requestNetlify,
  type BrowserNetlifyAccount, type BrowserNetlifySite,
} from "../lib/browser-netlify";

type Team = { id: string; slug: string; name: string };
type RemoteAccount = { user: { id: string; email: string }; teams: Team[] };
type Deployment = { id: string; date: string; url: string; state: string; canRestore: boolean };
type Phase = "loading" | "team" | "check" | "busy" | "done" | "error" | "history";
type PublishResult = { id: string; state: string; deploymentUrl: string; siteUrl: string };

export default function NetlifyPublishModal({
  conf, onClose,
}: {
  conf: StaticPublishModalConfig;
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
  const [result, setResult] = useState<PublishResult | null>(null);
  const [history, setHistory] = useState<Deployment[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const historyRequestRef = useRef(0);

  useEscapeToClose(onClose, phase !== "busy" && !restoring);
  useEffect(() => {
    if (phase !== "history") historyRequestRef.current++;
  }, [phase]);
  const checks = useMemo<CheckResult[]>(() => [
    ...runChecks(doc),
    ...exportLimitations(doc, {
      framework: "html", language: "javascript", style: "css", scope: "project",
    }).map((message): CheckResult => ({ level: "error", message })),
  ], [doc]);
  const blocked = !conf.configured || checks.some((item) => item.level === "error");

  const beginLogin = async () => {
    const config = await readNetlifyOAuthConfig();
    startNetlifyOAuth(conf.site, config);
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!conf.configured) {
        if (alive) {
          setError(conf.production.error || tr("Netlify OAuth is not configured."));
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
        setError(userMessage(cause, tr("Couldn't connect Netlify.")));
        setPhase("error");
      }
    })();
    return () => { alive = false; };
  // The editor mounts this dialog afresh for each Publish press.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conf.site, conf.configured]);

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
    if (typeof window.requestAnimationFrame === "function") {
      await new Promise<void>(resolve => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)));
    }
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
      setResult(data as PublishResult);
      setPhase("done");
    } catch (cause) {
      setError(userMessage(cause, tr("Couldn't publish")));
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
      const data = await requestNetlify<{ deployments: Deployment[] }>({
        action: "history", token: account.token,
        projectId: project.id, teamId: binding.teamId,
      });
      if (historyRequestRef.current !== requestId) return;
      setHistory(data.deployments);
    } catch (cause) {
      if (historyRequestRef.current !== requestId) return;
      setError(userMessage(cause, tr("Couldn't load publish history")));
    }
  };

  const restore = async (deployment: Deployment) => {
    if (!account || !binding || !deployment.canRestore || restoring) return;
    if (!await showConfirm(
      tr("Restore this deployment to the selected site? The live content will change."),
      { title: tr("Restore deployment"), okLabel: tr("Restore this version"), danger: true },
    )) return;
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
      setError(userMessage(cause, tr("Couldn't roll back")));
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
    try {
      disconnectNetlifyAccount();
      await beginLogin();
    } catch (cause) {
      setError(userMessage(cause, tr("Couldn't connect Netlify.")));
      setPhase("error");
    }
  };

  return (
    <div className="modal-backdrop" onClick={phase === "busy" || !!restoring ? undefined : onClose}>
      <div className="modal pub-modal" onClick={event => event.stopPropagation()}>
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
            <p className="hint">{account?.email} · {teams.find(team => team.id === binding?.teamId)?.name || binding?.teamSlug}</p>
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
              {teams.length > 1 && (
                <button className="btn btn-ghost" onClick={() => void changeTeam()}>
                  {tr("Change Netlify team")}
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => void reconnect()}>
                {tr("Switch Netlify account")}
              </button>
              <button className="btn" onClick={onClose}>{tr("Close")}</button>
            </div>
          </>
        )}
        {phase === "busy" && <div className="pub-loading is-large">
          <LoaderCircle className="spin" size={16}/>{progress}
        </div>}
        {phase === "done" && result && (
          <>
            <div className="check-ok"><Check size={14}/>{tr("Deployment submitted to {provider}.", { provider: "Netlify" })}</div>
            <p className="hint">{tr("Deployment status: {state}", { state: result.state })}</p>
            <div className="modal-actions">
              <a className="btn" href={result.deploymentUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13}/>{tr("View deployment")}</a>
              <a className="btn" href={result.siteUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13}/>{tr("Open site")}</a>
              <button className="btn btn-primary" onClick={onClose}>{tr("Close")}</button>
            </div>
          </>
        )}
        {phase === "error" && (
          <>
            <p className="pub-card-error" role="alert"><TriangleAlert size={14}/>{error}</p>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>{tr("Close")}</button>
              {account && binding && <button className="btn" onClick={() => setPhase("check")}>{tr("Back")}</button>}
              <button className="btn btn-primary" onClick={() => void reconnect()}>{tr("Connect Netlify")}</button>
            </div>
          </>
        )}
        {phase === "history" && (
          <>
            <p className="modal-desc">{tr("Netlify keeps deployment history. Editing data remains in your browser.")}</p>
            <Seg
              value={target}
              options={[
                { value: "production", label: tr("Live site") },
                { value: "test", label: tr("Test site") },
              ]}
              onChange={(next) => void openHistory(next as PublishTarget)}
            />
            {history === null && !error && <div className="pub-loading"><LoaderCircle className="spin" size={14}/>{tr("Loading…")}</div>}
            {error && <p className="pub-card-error" role="alert">{error}</p>}
            {history?.length === 0 && <p className="hint">{tr("Not published yet.")}</p>}
            {history && history.length > 0 && (
              <ol className="hist-list">
                {history.map(entry => (
                  <li key={entry.id}>
                    <div className="hist-main">
                      <a className="hist-msg" href={entry.url} target="_blank" rel="noopener noreferrer">
                        {entry.date ? new Date(entry.date).toLocaleString() : entry.id}
                      </a>
                      <span className="hist-date">{entry.state}</span>
                    </div>
                    {entry.canRestore && (
                      <div className="hist-acts">
                        <button className="btn btn-sm" disabled={!!restoring} onClick={() => void restore(entry)}>
                          <RotateCcw size={13}/>{restoring === entry.id ? tr("Restoring…") : tr("Restore this version")}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <div className="modal-actions">
              <button className="btn" disabled={!!restoring} onClick={() => setPhase("check")}>{tr("Back")}</button>
              <button className="btn" disabled={!!restoring} onClick={onClose}>{tr("Close")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
