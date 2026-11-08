"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { tr } from "../lib/i18n";
import { connectExternalEdit, disconnectExternalEdit, useExternalEdit } from "../lib/external-edit/bridge";
import { MCP_GUIDE_URL, useMcpPlugins } from "../lib/external-edit/plugins";

/** Published AI client plugins, plus a link to the relay's connection guide. */
function PluginLinks() {
  const catalog = useMcpPlugins();
  const guideUrl = catalog?.guideUrl ?? MCP_GUIDE_URL;
  return (
    <div className="mcp-plugins">
      <h4>{tr("Add Tsumu to your AI app")}</h4>
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
      </a>
    </div>
  );
}

export default function ExternalEditConnection() {
  const [allowEdit, setAllowEdit] = useState(true);
  const state = useExternalEdit();

  return (
    <section className="settings-sec">
      <h3>{tr("Connect an AI app")}</h3>
      <p className="hint">
        {tr("Connect ChatGPT, Claude or Cursor to this site without a Tsumu account. Keep this editor tab open while using AI.")}
      </p>
      {state.phase === "disconnected" && (
        <>
          <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0" }}>
            <input type="checkbox" checked={allowEdit} onChange={(e) => setAllowEdit(e.target.checked)} />
            {tr("Allow editing (not publishing or deleting assets)")}
          </label>
          <button type="button" className="btn btn-primary" onClick={() => { void connectExternalEdit(allowEdit); }}>
            {tr("Start connection")}
          </button>
        </>
      )}
      {state.phase === "connecting" && (
        <p role="status" className="hint">{tr("Connecting…")}</p>
      )}
      {state.phase === "connected" && (
        <div style={{ display: "grid", gap: 10, margin: "12px 0" }}>
          <p role="status"><strong>{tr("Connected")}</strong></p>
          <label>
            {tr("Connection code")}
            <input className="input" readOnly value={state.code ?? ""} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <p className="hint">
            {tr("Connect to Tsumu from your AI app, then enter this code on its authorization page. It expires in 10 minutes.")}
          </p>
          <p className="hint">
            {tr("Access: {permission}", {
              permission: state.canEdit ? tr("Read and edit") : tr("Read only"),
            })}
          </p>
          <button type="button" className="btn" onClick={() => { void disconnectExternalEdit(); }}>
            {tr("Disconnect and revoke")}
          </button>
        </div>
      )}
      {state.error && <p role="alert" style={{ color: "var(--danger, #b91c1c)" }}>{state.error}</p>}
      <PluginLinks />
    </section>
  );
}
