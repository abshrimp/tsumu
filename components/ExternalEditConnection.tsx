"use client";

import { useState } from "react";
import { Cable, Check, Copy, ExternalLink, LoaderCircle } from "lucide-react";
import { tr } from "../lib/i18n";
import { connectExternalEdit, disconnectExternalEdit, hasPendingRevocation, useExternalEdit } from "../lib/external-edit/bridge";
import { currentSiteId } from "../lib/site";
import { isOfficialEditorHost } from "../lib/external-edit/official.mjs";
import { knownReconnectSite } from "../lib/external-edit/reconnect-hint";
import { MCP_GUIDE_URL, useMcpPlugins } from "../lib/external-edit/plugins";

/** Published AI client plugins, plus a link to the relay's connection guide. */
function PluginLinks() {
  const catalog = useMcpPlugins();
  const guideUrl = catalog?.guideUrl ?? MCP_GUIDE_URL;
  return (
    <section className="mcp-plugins" aria-labelledby="mcp-plugins-title">
      <h3 id="mcp-plugins-title">{tr("Add Tsumu to your AI app")}</h3>
      {catalog && catalog.plugins.length > 0 && (
        <ul className="mcp-plugin-list">
          {catalog.plugins.map((plugin) => (
            <li key={plugin.id}>
              <a
                className="mcp-plugin"
                href={plugin.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={tr("Get the {name} plugin", { name: plugin.name })}
              >
                <span className="mcp-plugin-icon" aria-hidden><img src={plugin.icon} alt="" width={18} height={18} /></span>
                <span className="mcp-plugin-name">{plugin.name}</span>
                <ExternalLink className="mcp-plugin-action" size={13} aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}
      <a className="mcp-guide-link" href={guideUrl} target="_blank" rel="noopener noreferrer">
        {tr("See the connection guide")}
        <ExternalLink size={13} aria-hidden />
      </a>
    </section>
  );
}

export default function ExternalEditConnection({ siteCanEdit = true }: { siteCanEdit?: boolean } = {}) {
  const [allowEdit, setAllowEdit] = useState(true);
  const effectiveAllowEdit = siteCanEdit && allowEdit;
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [copyErrorCode, setCopyErrorCode] = useState<string | null>(null);
  const state = useExternalEdit();
  const siteId = currentSiteId();
  const official = typeof window !== "undefined" && isOfficialEditorHost(window.location.host);
  const pendingRevocation = hasPendingRevocation(siteId);
  const canDisconnect = state.phase !== "disconnected" || pendingRevocation || knownReconnectSite(siteId);
  const error = state.error ?? (!state.revoking && pendingRevocation
    ? tr("Could not confirm revocation. Check your connection and try again.") : null);

  const copyCode = async () => {
    if (!state.code) return;
    try {
      await navigator.clipboard.writeText(state.code);
      setCopiedCode(state.code);
      setCopyErrorCode(null);
    } catch {
      setCopyErrorCode(state.code);
    }
  };

  return (
    <section className="mcp-connection">
      <p className="mcp-intro">
        {official
          ? tr("Connect to Tsumu from your AI app and select this site. Keep this editor tab open while using AI.")
          : tr("Connect ChatGPT, Claude or Cursor to this site without a Tsumu account. Keep this editor tab open while using AI.")}
      </p>

      <div className="mcp-panel">
        <div className="mcp-panel-heading">
          <span className="mcp-panel-icon" aria-hidden><Cable size={17} /></span>
          <h3>{official ? tr("Connection status") : tr("Connect an AI app")}</h3>
          {state.phase === "connected" && (
            <span className="mcp-status" role="status"><Check size={13} aria-hidden />{tr("Connected")}</span>
          )}
        </div>

        {official && state.phase === "disconnected" && (
          <p role="status" className="mcp-progress">{tr("Not connected")}</p>
        )}

        {!official && state.phase === "disconnected" && (
          <>
            <label className="mcp-edit-option">
              <input type="checkbox" checked={effectiveAllowEdit} disabled={!siteCanEdit}
                onChange={(e) => setAllowEdit(e.target.checked)} />
              <span>{tr("Allow editing (not publishing or deleting assets)")}</span>
            </label>
            <button type="button" className="btn btn-primary mcp-main-action" disabled={state.revoking} onClick={() => { void connectExternalEdit(effectiveAllowEdit); }}>
              <Cable size={15} aria-hidden />
              {tr("Start connection")}
            </button>
          </>
        )}

        {state.phase === "connecting" && (
          <p role="status" className="mcp-progress"><LoaderCircle size={16} className="spin" aria-hidden />{tr("Connecting…")}</p>
        )}

        {!official && state.phase === "connected" && state.code && (
          <>
            <label className="mcp-code-label" htmlFor="mcp-connection-code">{tr("Connection code")}</label>
            <div className="mcp-code-row">
              <input
                id="mcp-connection-code"
                className="input mcp-code-input"
                readOnly
                value={state.code}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                className="btn mcp-copy-button"
                onClick={() => { void copyCode(); }}
                aria-label={tr("Copy connection code")}
              >
                {copiedCode === state.code ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                {copiedCode === state.code ? tr("Copied") : tr("Copy")}
              </button>
            </div>
            <p className="mcp-instructions">
              {tr("Connect to Tsumu from your AI app, then enter this code on its authorization page. It expires in 10 minutes.")}
            </p>
            {copyErrorCode === state.code && (
              <p role="alert" className="mcp-error">{tr("Could not copy the code. Select it to copy manually.")}</p>
            )}
          </>
        )}

        {(official || state.phase === "connected" || pendingRevocation || (state.error && canDisconnect)) && (
          <div className="mcp-session-footer">
            {state.phase === "connected" && (
              <span className="mcp-access">{tr("Access: {permission}", {
                permission: state.canEdit ? tr("Read and edit") : tr("Read only"),
              })}</span>
            )}
            <button type="button" className="btn" disabled={!canDisconnect || state.revoking} onClick={() => { void disconnectExternalEdit(); }}>
              {tr("Disconnect and revoke")}
            </button>
          </div>
        )}
        {error && <p role="alert" className="mcp-error">{error}</p>}
      </div>

      <PluginLinks />
    </section>
  );
}
