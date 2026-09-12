"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import { isEnterKey } from "../lib/keys";
import { showConfirm } from "../lib/dialog";
import { tr } from "../lib/i18n";

interface AllowedUsers {
  me: string;
  /** 環境変数 ALLOWED_EMAILS の固定分（削除不可） */
  fixed: string[];
  /** 設定画面で追加した分 */
  extra: string[];
}

/**
 * ログインできるアカウント（全サイト共通の設定。ホームの設定画面に置く）。
 * エディタの部品（store）を読み込まないため、ホームからも使える
 */
export default function AllowedAccounts() {
  const [users, setUsers] = useState<AllowedUsers | null>(null);
  /** 一覧そのものが使えない（認証を設定していない構成や、保存先が未設定の場合など） */
  const [fatal, setFatal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const pending = useRef<object | null>(null);
  useEffect(() => () => { pending.current = null; }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/allowed-users");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setFatal(data.error ?? tr("Couldn't load ({status})", { status: res.status }));
          return;
        }
        setUsers(data);
      } catch {
        if (!cancelled) setFatal(tr("Couldn't load"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const add = async () => {
    const v = email.trim();
    if (!v || pending.current) return;
    const request = {};
    pending.current = request;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/allowed-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: v }),
      });
      const data = await res.json();
      if (pending.current !== request) return;
      if (!res.ok) {
        setError(data.error ?? tr("Couldn't add"));
        return;
      }
      setUsers(data);
      setEmail(current => current.trim() === v ? "" : current);
    } catch {
      if (pending.current === request) setError(tr("Couldn't add"));
    } finally {
      if (pending.current === request) { pending.current = null; setBusy(false); }
    }
  };

  const remove = async (target: string) => {
    if (pending.current) return;
    const request = {};
    pending.current = request;
    setBusy(true);
    setError(null);
    try {
      const accepted = await showConfirm(tr("{target} will no longer be able to sign in to this editor.", { target }), {
        title: tr("Remove sign-in access?"),
        okLabel: tr("Remove"),
        danger: true,
      });
      if (!accepted || pending.current !== request) return;
      const res = await fetch(`/api/allowed-users?email=${encodeURIComponent(target)}`, { method: "DELETE" });
      const data = await res.json();
      if (pending.current !== request) return;
      if (!res.ok) {
        setError(data.error ?? tr("Couldn't delete"));
        return;
      }
      setUsers(data);
    } catch {
      if (pending.current === request) setError(tr("Couldn't delete"));
    } finally {
      if (pending.current === request) { pending.current = null; setBusy(false); }
    }
  };

  const row = (addr: string, fixed: boolean) => {
    const isMe = users?.me === addr;
    return (
      <div key={addr} className="acct-row">
        <span className="acct-email">{addr}</span>
        {isMe && <span className="acct-tag">{tr("You")}</span>}
        {fixed ? (
          <span
            className="acct-tag"
            title={tr("Allowed by the server settings, so it can't be removed here")}
          >
            {tr("Fixed")}
          </span>
        ) : (
          <button
            type="button"
            className="icon-btn"
            aria-label={isMe ? tr("You can't remove yourself") : tr("Remove sign-in access")}
            title={isMe ? tr("You can't remove yourself") : tr("Remove sign-in access")}
            disabled={isMe || busy}
            onClick={() => {
              if (!isMe) void remove(addr);
            }}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    );
  };

  if (fatal) {
    return (
      <p className="acct-error">
        <TriangleAlert size={14} />
        {fatal}
      </p>
    );
  }
  if (!users) {
    return (
      <div className="acct-loading">
        <LoaderCircle size={16} className="spin" />
        {tr("Loading…", "loading_variant_1")}
      </div>
    );
  }
  return (
    <>
      <div className="acct-list">
        {users.fixed.map((e) => row(e, true))}
        {users.extra.map((e) => row(e, false))}
        {!users.fixed.length && !users.extra.length && (
          <p className="hint" style={{ margin: 0 }}>
            {tr("No accounts have access yet.")}
          </p>
        )}
      </div>
      <div className="acct-add">
        <input
          className="input"
          type="email"
          value={email}
          placeholder="user@gmail.com"
          aria-label={tr("Email address to add")}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (isEnterKey(e)) void add();
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !email.trim()}
          onClick={() => void add()}
        >
          {tr("Add")}
        </button>
      </div>
      {error && <p className="acct-add-error">{error}</p>}
      <p className="hint acct-note">
        {tr("Added accounts can sign in. Removed accounts are restricted from their next access, even if already signed in.")}
      </p>
    </>
  );
}
