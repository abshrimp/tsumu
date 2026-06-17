"use client";

import { useEffect, useState } from "react";
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
 * ログインできるアカウント（全サイト共通の設定。ホームの設定に置く）。
 * エディタの部品（store）を読み込まないので、ホームからも使える
 */
export default function AllowedAccounts() {
  const [users, setUsers] = useState<AllowedUsers | null>(null);
  /** 一覧自体が使えない（未認証構成・保存先未設定など） */
  const [fatal, setFatal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/allowed-users");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setFatal(data.error ?? tr("読み込めませんでした（{status}）", { status: res.status }));
          return;
        }
        setUsers(data);
      } catch {
        if (!cancelled) setFatal(tr("読み込めませんでした"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const add = async () => {
    const v = email.trim();
    if (!v || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/allowed-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: v }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? tr("追加できませんでした"));
        return;
      }
      setUsers(data);
      setEmail("");
    } catch {
      setError(tr("追加できませんでした"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (target: string) => {
    if (
      !(await showConfirm(tr("「{target}」はこのエディタにログインできなくなります。", { target }), {
        title: tr("ログイン許可を取り消しますか？"),
        okLabel: tr("取り消す"),
        danger: true,
      }))
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/allowed-users?email=${encodeURIComponent(target)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? tr("削除できませんでした"));
        return;
      }
      setUsers(data);
    } catch {
      setError(tr("削除できませんでした"));
    } finally {
      setBusy(false);
    }
  };

  const row = (addr: string, fixed: boolean) => {
    const isMe = users?.me === addr;
    return (
      <div key={addr} className="acct-row">
        <span className="acct-email">{addr}</span>
        {isMe && <span className="acct-tag">{tr("自分")}</span>}
        {fixed ? (
          <span
            className="acct-tag"
            title={tr("サーバーの設定で許可されているため、ここからは削除できません")}
          >
            {tr("固定")}
          </span>
        ) : (
          <button
            type="button"
            className="icon-btn"
            aria-label={isMe ? tr("自分自身は削除できません") : tr("ログイン許可を取り消す")}
            title={isMe ? tr("自分自身は削除できません") : tr("ログイン許可を取り消す")}
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
        {tr("読み込んでいます…")}
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
            {tr("許可されたアカウントがありません。")}
          </p>
        )}
      </div>
      <div className="acct-add">
        <input
          className="input"
          type="email"
          value={email}
          placeholder="user@gmail.com"
          aria-label={tr("追加するメールアドレス")}
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
          {tr("追加")}
        </button>
      </div>
      {error && <p className="acct-add-error">{error}</p>}
      <p className="hint acct-note">
        {tr("追加・削除は次回のログインから反映されます（削除しても、ログイン中のセッションは有効期限まで残ります）。")}
      </p>
    </>
  );
}
