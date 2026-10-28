"use client";

import { useState } from "react";
import { tr } from "../lib/i18n";
import { connectExternalEdit, disconnectExternalEdit, useExternalEdit } from "../lib/external-edit/bridge";

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
            {tr("MCP URL")}
            <input className="input" readOnly value={state.mcpUrl} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <label>
            {tr("One-time pairing code")}
            <input className="input" readOnly value={state.code ?? ""} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <p className="hint">
            {tr("Register the MCP URL in your AI app, then enter this code on its authorization page. It expires in 10 minutes.")}
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
    </section>
  );
}
