"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, UserPlus, X } from "lucide-react";
import { tr } from "../lib/i18n";
import type { SiteRole } from "../lib/site-access";

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

  const request = useCallback(async (url: string, init?: RequestInit): Promise<Membership> => {
    const response = await fetch(url, { ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error ?? tr("Couldn't load"));
    return result as Membership;
  }, []);
  useEffect(() => {
    let active = true;
    void request(endpoint).then(v => { if (active) setData(v); }).catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, [endpoint, request]);

  const save = async (target: string, role: SiteRole) => {
    if (pending) return;
    setPending(target);
    setError(null);
    try {
      setData(await request(endpoint, { method: "PUT", body: JSON.stringify({ email: target, role }) }));
      if (target === email.trim().toLowerCase()) setEmail("");
    } catch (e) { setError((e as Error).message); }
    finally { setPending(null); }
  };
  const remove = async (target: string) => {
    if (pending) return;
    setPending(target);
    setError(null);
    try { setData(await request(`${endpoint}?email=${encodeURIComponent(target)}`, { method: "DELETE" })); }
    catch (e) { setError((e as Error).message); }
    finally { setPending(null); }
  };
  const options = [
    { value: "owner", label: tr("Site owner") },
    { value: "editor", label: tr("Editor role") },
    { value: "viewer", label: tr("View only") },
  ];
  return (
    <div className="modal-backdrop" onClick={pending ? undefined : onClose}>
      <div className="modal home-dialog" role="dialog" aria-modal="true" aria-label={tr("Members and permissions")}
        onClick={event => event.stopPropagation()}>
        <h2>{tr("Members and permissions")}</h2>
        <p className="modal-desc">{siteName}</p>
        <p className="home-field-hint">{tr("Only site owners can change membership. Accounts must first be allowed to sign in.")}</p>
        {error && <p className="home-dialog-error" role="alert">{error}</p>}
        {!data && !error && <p><LoaderCircle size={14} className="spin" /> {tr("Loading")}</p>}
        {data && (
          <div className="stack" style={{ gap: 12 }}>
            {data.fixed.map(addr => (
              <div className="acct-row" key={addr}>
                <span className="acct-email">{addr}</span>
                <span className="acct-tag">{tr("Instance administrator")}</span>
              </div>
            ))}
            {data.members.map(member => (
              <div className="acct-row" key={member.email}>
                <span className="acct-email">{member.email}</span>
                <select className="select acct-role" aria-label={tr("Role for {email}", { email: member.email })}
                  disabled={pending !== null} value={member.role}
                  onChange={e => void save(member.email, e.target.value as SiteRole)}>
                  {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
                <button type="button" className="btn btn-ghost" aria-label={tr("Remove {email}", { email: member.email })}
                  title={tr("Remove access")} disabled={pending !== null} onClick={() => void remove(member.email)}>
                  <X size={15} />
                </button>
              </div>
            ))}
            <form onSubmit={e => { e.preventDefault(); void save(email.trim().toLowerCase(), newRole); }}>
              <div className="home-field-row">
                <label className="home-field" style={{ flex: 2 }}>
                  <span className="home-field-label">{tr("Email address")}</span>
                  <input className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
                </label>
                <label className="home-field" style={{ flex: 1 }}>
                  <span className="home-field-label">{tr("Permission")}</span>
                  <select className="select" value={newRole} onChange={e => setNewRole(e.target.value as SiteRole)}>
                    {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </label>
              </div>
              <button className="btn" type="submit" disabled={pending !== null || !email.trim()}>
                <UserPlus size={14} /> {tr("Add member")}
              </button>
            </form>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" disabled={pending !== null} onClick={onClose}>{tr("Close")}</button>
        </div>
      </div>
    </div>
  );
}
