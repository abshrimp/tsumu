"use client";

import { useEffect, useRef } from "react";
import { tr } from "../lib/i18n";
import type { AiPhase, AiProgress } from "../lib/ai/progress";
import type { AiOp } from "../lib/aiOps";

export function phaseLabel(phase: AiPhase): string {
  switch (phase) {
    case "preparing": return tr("Sending page information…");
    case "planning": return tr("Planning the changes…");
    case "generating": return tr("Preparing edits…");
    case "validating": return tr("Validating edits…");
    case "repairing": return tr("Correcting edits…");
    case "reviewing": return tr("Reviewing the result…");
  }
}

export function opLabel(op: AiOp["op"]): string {
  const labels = {
    set_style: tr("Style changes"), set_text: tr("Text changes"), insert: tr("Elements added"),
    move: tr("Elements moved"), delete: tr("Elements removed"), duplicate: tr("Elements duplicated"),
    rename: tr("Names changed"), set_link: tr("Links changed"), set_image: tr("Images changed"),
    set_hidden: tr("Visibility settings"), update_page: tr("Page settings"),
  };
  return labels[op];
}

function operationLabel(event: Extract<AiProgress, { type: "operations" }>): string {
  const items = Object.entries(event.counts).map(([op, n]) => tr("{name}: {n}", { name: opLabel(op as AiOp["op"]), n: n! }));
  const verified = event.total ? tr("Validated {n} proposed edits", { n: event.total }) : tr("Checked the proposed edits");
  return [verified, items.join(" · "), event.errors ? tr("{n} operations need correction", { n: event.errors }) : ""].filter(Boolean).join("\n");
}

export default function AiActivity({ events, live = false }: { events: AiProgress[]; live?: boolean }) {
  const ref = useRef<HTMLOListElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (live && follow.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events, live]);
  if (!events.length) return null;
  return (
    <ol className="ai-activity-log" ref={ref} aria-label={tr("Activity log")} onScroll={() => {
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
