"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, ShieldCheck, UserRound, UserRoundPlus, UsersRound, X } from "lucide-react";
import { tr } from "../lib/i18n";
import type { SiteRole } from "../lib/site-model";
import { useEscapeToClose } from "../lib/use-escape-to-close";

type Member = { email: string; role: SiteRole };
type Membership = { members: Member[]; fixed: string[] };

export default function SiteMembers({ siteId, siteName, onClose }: {
  siteId: string;
  siteName: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<Membership | null>(null);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<SiteRole>("viewer");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endpoint = `/api/sites/${encodeURIComponent(siteId)}/members`;
  useEscapeToClose(onClose, pending === null);

  const request = useCallback(async (url: string, init?: RequestInit): Promise<Membership> => {
    const response = await fetch(url, { ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error ?? tr("Couldn't load"));
    return result as Membership;
  }, []);
  useEffect(() => {
    let active = true;
    void request(endpoint).then(
      value => { if (active) setData(value); },
      cause => { if (active) setError((cause as Error).message); }
    );
    return () => { active = false; };
  }, [endpoint, request]);

  const save = async (target: string, role: SiteRole) => {
    if (pending) return;
    setPending(target);
    setError(null);
    try {
      setData(await request(endpoint, { method: "PUT", body: JSON.stringify({ email: target, role }) }));
      if (target === email.trim().toLowerCase()) setEmail("");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPending(null);
    }
  };
  const remove = async (target: string) => {
    if (pending) return;
    setPending(target);
    setError(null);
    try {
      setData(await request(`${endpoint}?email=${encodeURIComponent(target)}`, { method: "DELETE" }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPending(null);
    }
  };

  const options = [
    { value: "owner", label: tr("Site owner") },
    { value: "editor", label: tr("Editor role") },
    { value: "viewer", label: tr("View only") },
  ];
  return (
    <div className="modal-backdrop" onClick={pending ? undefined : onClose}>
      <div className="modal site-members-modal" role="dialog" aria-modal="true" aria-labelledby="site-members-title"
        onClick={event => event.stopPropagation()}>
        <header className="site-members-header">
          <span className="site-members-emblem" aria-hidden="true"><UsersRound size={20} /></span>
          <div className="site-members-heading">
            <h2 id="site-members-title">{tr("Members and permissions")}</h2>
            <p title={siteName}>{siteName}</p>
          </div>
        </header>
        <div className="site-members-body">
          <p className="site-members-intro">{tr("Only site owners can change membership. Accounts must first be allowed to sign in.")}</p>
          {error && <p className="home-dialog-error" role="alert">{error}</p>}
          {!data && !error && (
            <div className="site-members-loading" role="status">
              <LoaderCircle size={16} className="spin" />{tr("Loading…")}
            </div>
          )}
          {data && (
            <>
              <section className="site-members-section" aria-label={tr("People with access")}>
                <h3>{tr("People with access")}</h3>
                <div className="site-members-list">
                  {data.fixed.map(addr => (
                    <div className="site-members-row" key={addr}>
                      <span className="site-members-avatar" aria-hidden="true"><ShieldCheck size={16} /></span>
                      <span className="site-members-email" title={addr}>{addr}</span>
                      <span className="site-members-badge">{tr("Instance administrator")}</span>
                    </div>
                  ))}
                  {data.members.map(member => (
                    <div className="site-members-row" key={member.email}>
                      <span className="site-members-avatar" aria-hidden="true"><UserRound size={16} /></span>
                      <span className="site-members-email" title={member.email}>{member.email}</span>
                      <select className="select site-members-role" aria-label={tr("Role for {email}", { email: member.email })}
                        disabled={pending !== null} value={member.role}
                        onChange={event => void save(member.email, event.target.value as SiteRole)}>
                        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                      <button type="button" className="icon-btn site-members-remove"
                        aria-label={tr("Remove {email}", { email: member.email })}
                        title={tr("Remove access")} disabled={pending !== null}
                        onClick={() => void remove(member.email)}><X size={16} /></button>
                    </div>
                  ))}
                  {data.fixed.length === 0 && data.members.length === 0 && (
                    <p className="site-members-empty">{tr("No members yet")}</p>
                  )}
                </div>
              </section>
              <section className="site-members-section">
                <h3>{tr("Add member")}</h3>
                <form className="site-members-form" onSubmit={event => {
                  event.preventDefault();
                  void save(email.trim().toLowerCase(), newRole);
                }}>
                  <label className="home-field">
                    <span className="home-field-label">{tr("Email address")}</span>
                    <input className="input" type="email" autoComplete="email" required value={email}
                      disabled={pending !== null} onChange={event => setEmail(event.target.value)} />
                  </label>
                  <label className="home-field">
                    <span className="home-field-label">{tr("Permission")}</span>
                    <select className="select" value={newRole} disabled={pending !== null}
                      onChange={event => setNewRole(event.target.value as SiteRole)}>
                      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <button className="btn btn-primary site-members-add" type="submit"
                    disabled={pending !== null || !email.trim()}>
                    {pending === email.trim().toLowerCase()
                      ? <LoaderCircle size={14} className="spin" />
                      : <UserRoundPlus size={14} />}
                    {tr("Add member")}
                  </button>
                </form>
              </section>
            </>
          )}
        </div>
        <footer className="site-members-footer">
          <button type="button" className="btn" disabled={pending !== null} onClick={onClose}>{tr("Close")}</button>
        </footer>
      </div>
    </div>
  );
}
