"use client";

import { useState } from "react";
import { User } from "lucide-react";
import type { ActivityUser } from "../lib/activity";

/** アカウントの丸いアイコン（Googleのプロフィール画像。無ければ頭文字） */
export default function UserAvatar({ user, size = 24 }: { user: ActivityUser; size?: number }) {
  const [broken, setBroken] = useState(false);
  const label = user.name || user.email;
  const style = { width: size, height: size, fontSize: Math.round(size * 0.46) };
  return user.image && !broken ? (
    // 参照元を送らないと、Googleのプロフィール画像を表示できる
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="user-avatar"
      style={style}
      src={user.image}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  ) : (
    <span className="user-avatar is-initial" style={style} aria-hidden>
      {/* ログインなしで使っているとき（名前の無い人）は人の形 */}
      {label ? Array.from(label)[0]?.toUpperCase() : <User size={Math.round(size * 0.6)} />}
    </span>
  );
}

/** 表示する名前（ログインなしで使っているときは「ゲスト」） */
export function userLabel(user: ActivityUser, guest: string): string {
  return user.name || user.email || guest;
}
