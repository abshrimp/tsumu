"use client";

import { useEffect, useRef } from "react";
import { tr } from "../lib/i18n";
import type { AiPhase, AiProgress } from "../lib/ai/progress";
import type { AiOp } from "../lib/aiOps";

export function phaseLabel(phase: AiPhase): string {
  switch (phase) {
    case "preparing": return tr("ページ情報を送信しています…");
    case "planning": return tr("変更内容を検討しています…");
    case "generating": return tr("変更案を作成しています…");
    case "validating": return tr("変更案を検証しています…");
    case "repairing": return tr("変更案を修正しています…");
    case "reviewing": return tr("結果を確認しています…");
  }
}

export function opLabel(op: AiOp["op"]): string {
  const labels = {
    set_style: tr("スタイル変更"), set_text: tr("文字変更"), insert: tr("要素追加"),
    move: tr("要素移動"), delete: tr("要素削除"), duplicate: tr("要素複製"),
    rename: tr("名前変更"), set_link: tr("リンク変更"), set_image: tr("画像変更"),
    set_hidden: tr("表示設定"), update_page: tr("ページ設定"),
  };
  return labels[op];
}

function operationLabel(event: Extract<AiProgress, { type: "operations" }>): string {
  const items = Object.entries(event.counts).map(([op, n]) => tr("{name} {n}件", { name: opLabel(op as AiOp["op"]), n: n! }));
  const verified = event.total ? tr("変更案を{n}件検証しました", { n: event.total }) : tr("変更案を確認しました");
  return [verified, items.join(" · "), event.errors ? tr("{n}件の操作に修正が必要です", { n: event.errors }) : ""].filter(Boolean).join("\n");
}

export default function AiActivity({ events, live = false }: { events: AiProgress[]; live?: boolean }) {
  const ref = useRef<HTMLOListElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (live && follow.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events, live]);
  if (!events.length) return null;
  return (
    <ol className="ai-activity-log" ref={ref} aria-label={tr("作業の記録")} onScroll={() => {
      const list = ref.current;
      if (list) follow.current = list.scrollHeight - list.scrollTop - list.clientHeight < 32;
    }}>
      {events.map((event, i) => (
        <li key={i} className={`is-${event.type}`}>
          {event.type === "phase" ? phaseLabel(event.phase) : event.type === "text" ? event.text : operationLabel(event)}
        </li>
      ))}
    </ol>
  );
}
