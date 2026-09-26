"use client";

/**
 * きっかけを言葉の説明なしで伝えるための小さな絵。
 * 要素は角丸の四角、ポインターは矢印、動きは細い線で表す。
 */

import type { ScriptTrigger } from "../../lib/types";

const Pointer = ({ x, y }: { x: number; y: number }) => (
  <path
    transform={`translate(${x} ${y})`}
    d="M0 0v13l3.6-3.2 2.4 5.4 2.2-1-2.4-5.3H10.6z"
    fill="var(--panel)" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"
  />
);

const Box = ({ x = 10, y = 12, w = 36, h = 18, on = false }: { x?: number; y?: number; w?: number; h?: number; on?: boolean }) => (
  <rect x={x} y={y} width={w} height={h} rx="6"
    fill={on ? "color-mix(in srgb, var(--cat) 28%, var(--panel))" : "color-mix(in srgb, var(--cat) 10%, var(--panel))"}
    stroke="var(--cat)" strokeWidth="1.4" />
);

const ART: Record<ScriptTrigger, React.ReactNode> = {
  click: (
    <>
      <Box on />
      <g stroke="var(--cat)" strokeWidth="1.6" strokeLinecap="round">
        <path d="M38 8v-4M45 11l3-3M48 18h4" />
      </g>
      <Pointer x={34} y={19} />
    </>
  ),
  "hover-start": (
    <>
      <Box on />
      <path d="M62 34 46 26" stroke="var(--cat)" strokeWidth="1.4" strokeDasharray="2 3" strokeLinecap="round" />
      <Pointer x={36} y={19} />
    </>
  ),
  "hover-end": (
    <>
      <Box />
      <path d="M40 24 54 30" stroke="var(--cat)" strokeWidth="1.4" strokeDasharray="2 3" strokeLinecap="round" />
      <Pointer x={56} y={24} />
    </>
  ),
  change: (
    <>
      <Box x={6} w={52} />
      <g fill="var(--cat)">
        <rect x="13" y="19" width="5" height="4" rx="1.5" />
        <rect x="21" y="19" width="5" height="4" rx="1.5" />
        <rect x="29" y="19" width="5" height="4" rx="1.5" opacity="0.45" />
      </g>
      <path d="M38 16v10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  load: (
    <>
      <rect x="16" y="4" width="32" height="34" rx="5" fill="color-mix(in srgb, var(--cat) 10%, var(--panel))" stroke="var(--cat)" strokeWidth="1.4" />
      <g stroke="var(--cat)" strokeWidth="1.6" strokeLinecap="round" opacity="0.6">
        <path d="M22 12h14M22 18h20M22 24h20M22 30h10" />
      </g>
      <path d="M53 6l1.4 3.6L58 11l-3.6 1.4L53 16l-1.4-3.6L48 11l3.6-1.4z" fill="var(--cat)" />
    </>
  ),
  "in-view": (
    <>
      <rect x="14" y="4" width="36" height="26" rx="5" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
      <Box x={20} y={20} w={24} h={16} on />
      <path d="M58 30V14m-4 4 4-4 4 4" fill="none" stroke="var(--cat)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
};

export function TriggerArt({ trigger }: { trigger: ScriptTrigger }) {
  return (
    <svg className="se-art" viewBox="0 0 66 42" width="66" height="42" aria-hidden="true">
      {ART[trigger]}
    </svg>
  );
}
