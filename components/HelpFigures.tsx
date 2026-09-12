/**
 * ヘルプの記事に入れる図解。並べ方・余白・画像の切り抜きなどは、説明している CSS を
 * そのまま使って描く（図そのものが、実際の見え方の見本になる）
 */

import type { CSSProperties, ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  Folder,
  FileText,
  Menu,
  Monitor,
  MousePointer2,
  Pencil,
  Smartphone,
  Tablet,
  X,
} from "lucide-react";
import { tr } from "../lib/i18n";

/* ---------- 部品 ---------- */

/** 中身の要素（灰色の四角） */
function I({ w, h, accent, style }: { w?: number | string; h?: number | string; accent?: boolean; style?: CSSProperties }) {
  return <i className={`hf-item${accent ? " is-accent" : ""}`} style={{ width: w, height: h, ...style }} />;
}

/** 文字の行（細い棒） */
function Lines({ n, w = "100%", dark }: { n: number; w?: number | string; dark?: boolean }) {
  return (
    <span className="hf-lines">
      {Array.from({ length: n }, (_, i) => (
        <b key={i} className={dark ? "is-dark" : ""} style={{ width: i === n - 1 && n > 1 ? "62%" : w }} />
      ))}
    </span>
  );
}

function Label({ children, tone, wrap }: { children: ReactNode; tone?: "accent" | "warn" | "bad" | "good"; wrap?: boolean }) {
  return <span className={`hf-label${tone ? ` is-${tone}` : ""}${wrap ? " is-wrap" : ""}`}>{children}</span>;
}

function Arrow({ down }: { down?: boolean }) {
  return down ? <ArrowDown className="hf-arrow" size={16} /> : <ArrowRight className="hf-arrow" size={16} />;
}

/** よくない例 / よい例 を並べる */
function Compare({
  bad,
  good,
  badLabel,
  goodLabel,
  stack,
}: {
  bad: ReactNode;
  good: ReactNode;
  badLabel: string;
  goodLabel: string;
  /** 上下に並べる（横幅を使う図） */
  stack?: boolean;
}) {
  return (
    <div className={`hf-compare${stack ? " is-stack" : ""}`}>
      <div className="hf-side is-bad">
        <div className="hf-side-head">
          <X size={12} strokeWidth={2.6} />
          {badLabel}
        </div>
        {bad}
      </div>
      <div className="hf-side is-good">
        <div className="hf-side-head">
          <Check size={12} strokeWidth={2.6} />
          {goodLabel}
        </div>
        {good}
      </div>
    </div>
  );
}

/** パソコン・スマホの画面の枠 */
function Screen({ kind, children, style, label }: { kind: "pc" | "phone"; children: ReactNode; style?: CSSProperties; label?: ReactNode }) {
  return (
    <div className="hf-col">
      <div className={`hf-screen is-${kind}`} style={style}>
        {children}
      </div>
      {label && <Label>{label}</Label>}
    </div>
  );
}

/** 写真の見本（正方形の風景） */
const PHOTO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#d6e4fb"/><circle cx="70" cy="30" r="13" fill="#f4bf4f"/><path d="M0 74 28 46l22 20 20-18 30 28v24H0Z" fill="#6c97ea"/><path d="M0 86l34-22 26 18 40-14v32H0Z" fill="#2f5fb8"/></svg>'
)}`;

/* ---------- 図 ---------- */

/** エディタの画面の4つの場所 */
function EditorMap() {
  return (
    <div className="hf-editor">
      <div className="hf-ed-top">
        <b>{tr("Top bar")}</b>{tr("Screen width, preview, publish")}
      </div>
      <div className="hf-ed-main">
        <div className="hf-ed-side">
          <b>{tr("Left panel")}</b>
          <span>{tr("Add and select")}</span>
          <Lines n={4} w="80%" />
        </div>
        <div className="hf-ed-canvas">
          <b>{tr("Canvas")}</b>
          <span>{tr("View, click to select")}</span>
          <div className="hf-ed-page">
            <I h={6} w="40%" />
            <I h={18} w="70%" accent />
            <I h={6} w="55%" />
          </div>
        </div>
        <div className="hf-ed-side">
          <b>{tr("Right panel")}</b>
          <span>{tr("Change the selection")}</span>
          <Lines n={4} />
        </div>
      </div>
    </div>
  );
}

/** フローの4種類 */
function FlowModes() {
  const modes: [string, string][] = [
    [tr("automatic"), "block"],
    [tr("Vertical flow"), "col"],
    [tr("Horizontal flow"), "row"],
    [tr("Grid"), "grid"],
  ];
  return (
    <div className="hf-row hf-wrap">
      {modes.map(([label, kind]) => (
        <div key={kind} className="hf-col">
          <div className={`hf-box hf-flow is-${kind}`}>
            <i />
            <i />
            <i />
            {kind === "grid" && <i />}
          </div>
          <Label>{label}</Label>
        </div>
      ))}
    </div>
  );
}

/** 親のフローを変えると、中の要素が横に並ぶ */
function ParentRow() {
  return (
    <div className="hf-row">
      <div className="hf-col">
        <div className="hf-box is-sel hf-flow is-col hf-flow-lg">
          <i />
          <i />
          <i />
        </div>
        <Label>{tr("Vertical (↓)")}</Label>
      </div>
      <Arrow />
      <div className="hf-col">
        <div className="hf-box is-sel hf-flow is-row hf-flow-lg">
          <i />
          <i />
          <i />
        </div>
        <Label>{tr("Horizontal (→)")}</Label>
      </div>
    </div>
  );
}

/** 配置の3×3で、真ん中に寄せる */
function AlignCenter() {
  return (
    <div className="hf-row">
      <div className="hf-pick">
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} className={i === 4 ? "is-on" : ""} />
        ))}
      </div>
      <Arrow />
      <div className="hf-box is-sel" style={{ width: 150, height: 90, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <I w={52} h={24} accent />
      </div>
    </div>
  );
}

/** 子ごとの外側の余白より、親の間隔を使う */
function GapVsMargin() {
  const row = (gaps: number[], sel?: boolean) => (
    <div className={`hf-box${sel ? " is-sel" : ""}`} style={{ display: "flex", alignItems: "center", padding: 6, marginBottom: 14 }}>
      <I w={28} h={26} />
      {gaps.map((g, i) => (
        <span key={i} style={{ display: "contents" }}>
          <span className="hf-gap" style={{ width: g }}>
            <em>{g}</em>
          </span>
          <I w={28} h={26} />
        </span>
      ))}
    </div>
  );
  return (
    <Compare
      badLabel={tr("A margin on each child")}
      goodLabel={tr("One Gap on the parent")}
      bad={row([6, 24])}
      good={row([16, 16], true)}
    />
  );
}

/** 内側の余白と外側の余白 */
function BoxModel() {
  return (
    <div className="hf-row">
      <div className="hf-bm">
        <span className="hf-bm-name">{tr("Margin")}</span>
        <div className="hf-bm-border">
          <span className="hf-bm-name is-in">{tr("Padding")}</span>
          <div className="hf-bm-content">{tr("Content")}</div>
        </div>
      </div>
      <div className="hf-col" style={{ alignItems: "flex-start", gap: 8 }}>
        <span className="hf-key">
          <i className="is-in" />
          {tr("Padding: inside the border. Gets the background color")}
        </span>
        <span className="hf-key">
          <i className="is-out" />
          {tr("Margin: outside the border. No background color")}
        </span>
      </div>
    </div>
  );
}

/** % は親に合わせる・残りを埋める */
function WidthPercent() {
  return (
    <div className="hf-stack">
      <div className="hf-box" style={{ padding: 6, width: "100%" }}>
        <I w="50%" h={20} accent />
      </div>
      <div className="hf-row" style={{ justifyContent: "space-between", width: "100%" }}>
        <Label tone="accent">{tr("Width 50% = half the parent")}</Label>
        <Label>{tr("Stays half when the parent resizes")}</Label>
      </div>
      <div className="hf-box" style={{ padding: 6, width: "100%", display: "flex", gap: 6 }}>
        <I w={28} h={20} />
        <I h={20} accent style={{ flex: 1 }} />
      </div>
      <Label tone="accent">{tr("\"Fill remaining space\" = all space left by its neighbors")}</Label>
    </div>
  );
}

/** 背景は画面いっぱい、中身は最大幅で中央に置く */
function MaxWidth() {
  return (
    <div className="hf-stack">
      <div className="hf-screen is-pc" style={{ width: "100%", padding: 0 }}>
        <div className="hf-band">
          <div className="hf-box is-sel" style={{ width: "58%", margin: "0 auto", padding: 8 }}>
            <Lines n={3} dark />
          </div>
        </div>
      </div>
      <div className="hf-row" style={{ gap: 6 }}>
        <Label>{tr("Background band: full width")}</Label>
        <Label tone="accent">{tr("Content: max width, centered")}</Label>
      </div>
    </div>
  );
}

/** パソコン3列 → スマホ1列 */
function GridResponsive() {
  return (
    <div className="hf-row" style={{ alignItems: "flex-end" }}>
      <Screen kind="pc" label={tr("Desktop: 3 columns")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5 }}>
          <I h={34} />
          <I h={34} />
          <I h={34} />
        </div>
      </Screen>
      <Arrow />
      <Screen kind="phone" label={<span className="is-warn-text">{tr("Phone: 1 column")}</span>}>
        <div style={{ display: "grid", gap: 5 }}>
          <I h={22} />
          <I h={22} />
          <I h={22} />
        </div>
      </Screen>
    </div>
  );
}

/** 横並びを、スマホでは縦に並べる */
function StackOnMobile() {
  return (
    <div className="hf-row" style={{ alignItems: "flex-end" }}>
      <Screen kind="pc" label={tr("Desktop: horizontal flow")}>
        <div className="hf-box is-sel" style={{ display: "flex", gap: 5, padding: 5 }}>
          <I h={30} style={{ flex: 1 }} />
          <I h={30} style={{ flex: 1 }} />
          <I h={30} style={{ flex: 1 }} />
        </div>
      </Screen>
      <Arrow />
      <Screen kind="phone" label={<span className="is-warn-text">{tr("Vertical flow on phones only")}</span>}>
        <div className="hf-box is-sel is-bp" style={{ display: "flex", flexDirection: "column", gap: 4, padding: 4 }}>
          <I h={16} />
          <I h={16} />
          <I h={16} />
        </div>
      </Screen>
    </div>
  );
}

/** 横並びの折り返し */
function Wrap() {
  const tags = [34, 48, 28, 40, 30];
  const box = (wrap: boolean) => (
    <div className="hf-box is-sel" style={{ display: "flex", flexWrap: wrap ? "wrap" : "nowrap", gap: 4, padding: 5, width: 112 }}>
      {tags.map((w, i) => (
        <i key={i} className="hf-chip" style={{ width: w, flex: "none" }} />
      ))}
    </div>
  );
  return <Compare badLabel={tr("No wrap (overflows)")} goodLabel={tr("Wrap", "wrap_variant_1")} bad={<div className="hf-clipx">{box(false)}</div>} good={box(true)} />;
}

/** 自由な位置（カスタム）は親が基準になる */
function PositionCustom() {
  return (
    <div className="hf-row">
      <div className="hf-box is-sel" style={{ position: "relative", width: 170, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        <I h={44} />
        <Lines n={2} dark />
        <span className="hf-badge" style={{ position: "absolute", top: 12, right: 12 }}>
          NEW
        </span>
        <span className="hf-dim is-y" style={{ top: 0, right: 26, height: 12 }} />
        <span className="hf-dim is-x" style={{ top: 18, right: 0, width: 12 }} />
      </div>
      <div className="hf-col" style={{ alignItems: "flex-start", gap: 6, maxWidth: 150 }}>
        <Label tone="accent" wrap>
          {tr("X and Y are distances from the parent (blue frame)")}
        </Label>
        <Label wrap>{tr("Other elements are laid out as if the badge weren't there")}</Label>
      </div>
    </div>
  );
}

/** 追従するヘッダー */
function Sticky() {
  const page = (scrolled: boolean) => (
    <div className="hf-screen is-phone" style={{ height: 120, padding: 0, overflow: "hidden" }}>
      <div className="hf-sticky-head">
        <i />
        <Menu size={9} />
      </div>
      <div style={{ padding: 5, display: "flex", flexDirection: "column", gap: 5, transform: scrolled ? "translateY(-46px)" : undefined }}>
        <I h={34} />
        <Lines n={3} />
        <I h={24} />
        <Lines n={3} />
        <I h={24} />
      </div>
    </div>
  );
  return (
    <div className="hf-row">
      <div className="hf-col">
        {page(false)}
        <Label>{tr("Top of the page")}</Label>
      </div>
      <div className="hf-col">
        <Arrow down />
        <Label>{tr("Scroll")}</Label>
      </div>
      <div className="hf-col">
        {page(true)}
        <Label tone="accent">{tr("The header stays at the top")}</Label>
      </div>
    </div>
  );
}

/** 最小高さ 100vh */
function MinHeightVh() {
  return (
    <div className="hf-row" style={{ alignItems: "stretch" }}>
      <div className="hf-screen is-pc" style={{ width: 190, height: 112, padding: 0, overflow: "hidden" }}>
        <div className="hf-hero">
          <I h={8} w="60%" style={{ background: "#fff" }} />
          <I h={5} w="40%" style={{ background: "rgba(255,255,255,0.7)" }} />
        </div>
      </div>
      <div className="hf-vh">
        <span>100vh</span>
      </div>
      <div className="hf-col" style={{ alignItems: "flex-start", justifyContent: "center" }}>
        <Label tone="accent">{tr("Min height 100vh")}</Label>
        <Label>{tr("= exactly the screen height")}</Label>
        <Label>{tr("Grows if there's more content")}</Label>
      </div>
    </div>
  );
}

/** 固定の px 幅と、% ＋ 最大幅 */
function UnitsCompare() {
  const pair = (fixed: boolean) => (
    <div className="hf-row" style={{ alignItems: "flex-end", justifyContent: "flex-start", gap: 8 }}>
      <div className="hf-col">
        <div className="hf-screen is-pc" style={{ width: 72 }}>
          <I h={16} w="80%" accent={!fixed} style={{ margin: "0 auto" }} />
        </div>
        <Label>{tr("Desktop")}</Label>
      </div>
      <div className="hf-col">
        <div className="hf-screen is-phone" style={{ width: 40, overflow: "visible" }}>
          {fixed ? <I h={16} w={58} style={{ background: "var(--hf-bad)", opacity: 0.8 }} /> : <I h={16} w="100%" accent />}
        </div>
        <Label tone={fixed ? "bad" : "good"}>{tr("Phone")}</Label>
      </div>
    </div>
  );
  return <Compare badLabel={tr("Width 800px")} goodLabel={tr("Width 100% + max width 800px")} bad={pair(true)} good={pair(false)} />;
}

/** 高さを固定すると、文字があふれる */
function FixedHeight() {
  return (
    <Compare
      badLabel={tr("Height fixed at 60px")}
      goodLabel={tr("Height empty (fits content)")}
      bad={
        <div className="hf-box is-bad" style={{ height: 44, padding: 6, marginBottom: 28 }}>
          <Lines n={7} dark />
        </div>
      }
      good={
        <div className="hf-box" style={{ padding: 6 }}>
          <Lines n={7} dark />
        </div>
      }
    />
  );
}

/** 自由配置は、狭い画面で重なる */
function FlowVsAbsolute() {
  return (
    <Compare
      badLabel={tr("Placed by X/Y (phone)")}
      goodLabel={tr("Arranged by flow (phone)")}
      bad={
        <div className="hf-screen is-phone" style={{ position: "relative", height: 96, margin: "0 auto" }}>
          <I w={50} h={30} style={{ position: "absolute", top: 8, left: 6 }} />
          <I w={52} h={30} style={{ position: "absolute", top: 24, left: 22, background: "var(--hf-bad)", opacity: 0.75 }} />
          <I w={40} h={22} style={{ position: "absolute", top: 46, left: 12 }} />
        </div>
      }
      good={
        <div className="hf-screen is-phone" style={{ display: "flex", flexDirection: "column", gap: 5, height: 96, margin: "0 auto" }}>
          <I h={26} />
          <I h={26} accent />
          <I h={18} />
        </div>
      }
    />
  );
}

/** ブレークポイントの効く範囲 */
function BreakpointCascade() {
  const zones: [string, string, number][] = [
    [tr("Phone"), "〜478", 20],
    [tr("Phone (landscape)"), "〜767", 22],
    [tr("Tablet"), "〜1024", 24],
    [tr("Desktop"), "1025〜", 34],
  ];
  return (
    <div className="hf-stack">
      <div className="hf-bp">
        {zones.map(([name, w, f]) => (
          <div key={name} className="hf-bp-zone" style={{ flex: f }}>
            <b>{name}</b>
            <span>{w}</span>
          </div>
        ))}
      </div>
      <div className="hf-bp-bar is-base">{tr("Desktop settings → apply to every screen")}</div>
      <div className="hf-bp-bar is-bp" style={{ width: "21%" }}>
        {tr("Overridden on phone")}
      </div>
      <Label>{tr("Smaller screens take priority, overriding only what changed")}</Label>
    </div>
  );
}

/** デバイスごとの表示 */
function DeviceVisibility() {
  return (
    <div className="hf-row">
      <div className="hf-col">
        <div className="hf-devices">
          <span className="is-on"><Monitor size={13} /></span>
          <span className="is-on"><Tablet size={13} /></span>
          <span className="is-on"><Smartphone size={13} style={{ rotate: "90deg" }} /></span>
          <span><Smartphone size={13} /></span>
        </div>
        <Label>{tr("Off on phones only")}</Label>
      </div>
      <Arrow />
      <Screen kind="pc" label={tr("Show")} style={{ width: 92 }}>
        <I h={10} w="60%" />
        <I h={20} accent style={{ marginTop: 5 }} />
      </Screen>
      <Screen kind="phone" label={<span className="is-warn-text">{tr("Don't show")}</span>}>
        <I h={10} w="70%" />
        <i className="hf-ghost" />
      </Screen>
    </div>
  );
}

/** 見出しの段 */
function HeadingOutline() {
  const row = (lv: number, label: string, desc: string, bad?: boolean) => (
    <div className={`hf-h${bad ? " is-bad" : ""}`} style={{ paddingLeft: (lv - 1) * 18 }}>
      <span className="hf-h-tag">{tr("Heading {n}", { n: lv })}</span>
      <span className="hf-h-name">{label}</span>
      <span className="hf-h-desc">{desc}</span>
    </div>
  );
  return (
    <div className="hf-stack" style={{ alignItems: "stretch" }}>
      {row(1, tr("Sunny Café"), tr("Page title, only one"))}
      {row(2, tr("About us", "about_us_variant_1"), tr("threshold"))}
      {row(3, tr("Directions"), tr("More detail"))}
      {row(2, tr("Menu"), tr("threshold"))}
      <div className="hf-h-note">
        <X size={12} strokeWidth={2.6} />
        {tr("Heading 2 jumping straight to Heading 4 (skipping a level)")}
      </div>
    </div>
  );
}

/** 文字サイズの段階 */
function TypeScale() {
  const rows: [string, number][] = [
    [tr("Heading 1"), 44],
    [tr("Heading 2"), 30],
    [tr("Heading 3"), 22],
    [tr("Body"), 16],
    [tr("Note"), 12],
  ];
  return (
    <div className="hf-stack" style={{ alignItems: "stretch", gap: 2 }}>
      {rows.map(([name, px]) => (
        <div key={name} className="hf-type">
          <span className="hf-type-name">{name}</span>
          <span className="hf-type-sample" style={{ fontSize: Math.round(px * 0.6), fontWeight: px >= 22 ? 700 : 400 }}>
            {tr("Welcome in")}
          </span>
          <span className="hf-type-px">{px}px</span>
        </div>
      ))}
    </div>
  );
}

/** 余白の刻みと、近いものは近く */
function SpacingScale() {
  return (
    <div className="hf-row" style={{ alignItems: "flex-start", gap: 18 }}>
      <div className="hf-col" style={{ alignItems: "flex-start", gap: 3 }}>
        {[4, 8, 16, 24, 32, 48, 64].map((n) => (
          <div key={n} className="hf-scale">
            <i style={{ width: n * 1.4 }} />
            <span>{n}</span>
          </div>
        ))}
        <Label>{tr("Decide how many you'll use")}</Label>
      </div>
      <div className="hf-col" style={{ alignItems: "stretch", gap: 0, width: 120 }}>
        <I h={9} w="70%" style={{ background: "var(--hf-ink)" }} />
        <span className="hf-gap is-v" style={{ height: 8 }}>
          <em>8</em>
        </span>
        <Lines n={2} />
        <span className="hf-gap is-v" style={{ height: 28 }}>
          <em>32</em>
        </span>
        <I h={9} w="60%" style={{ background: "var(--hf-ink)" }} />
        <span className="hf-gap is-v" style={{ height: 8 }}>
          <em>8</em>
        </span>
        <Lines n={2} />
        <Label>{tr("Tight within groups, wide between them")}</Label>
      </div>
    </div>
  );
}

/** 色の割合とコントラスト */
function ColorRatio() {
  const roles: [string, string, number, string][] = [
    [tr("Base"), "#ffffff", 70, tr("Backgrounds, large areas")],
    [tr("Main"), "#3b6fd8", 25, tr("Headings, bands, logo")],
    [tr("Accent"), "#f08c2b", 5, tr("Buttons and other things to click")],
  ];
  return (
    <div className="hf-stack" style={{ alignItems: "stretch" }}>
      <div className="hf-ratio">
        {roles.map(([name, color, pct]) => (
          <span key={name} style={{ flex: pct, background: color }} />
        ))}
      </div>
      <div className="hf-row" style={{ alignItems: "flex-start", justifyContent: "space-between" }}>
        <div className="hf-col" style={{ alignItems: "flex-start", gap: 4 }}>
          {roles.map(([name, color, pct, use]) => (
            <span key={name} className="hf-key">
              <i style={{ background: color, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)" }} />
              <b>
                {name} {pct}%
              </b>
              {use}
            </span>
          ))}
        </div>
        <div className="hf-col" style={{ gap: 4 }}>
          <span className="hf-contrast" style={{ color: "#1f1f1f" }}>
            <Check size={12} strokeWidth={2.6} className="is-good" />
            {tr("Easy to read")}
          </span>
          <span className="hf-contrast" style={{ color: "#c4c8ce" }}>
            <X size={12} strokeWidth={2.6} className="is-bad" />
            {tr("Hard to read")}
          </span>
        </div>
      </div>
    </div>
  );
}

/** 1行の長さ */
function LineLength() {
  return (
    <Compare
      stack
      badLabel={tr("Spans the whole screen")}
      goodLabel={tr("Max width keeps lines comfortable")}
      bad={
        <div className="hf-box" style={{ padding: 8 }}>
          <Lines n={3} dark />
        </div>
      }
      good={
        <div className="hf-box" style={{ padding: 8 }}>
          <div style={{ maxWidth: "58%", margin: "0 auto" }}>
            <Lines n={5} dark />
          </div>
        </div>
      }
    />
  );
}

/** 主役は1つ */
function Hierarchy() {
  return (
    <Compare
      badLabel={tr("Everything equally loud")}
      goodLabel={tr("One clear focus")}
      bad={
        <div className="hf-box" style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <I h={10} w="80%" style={{ background: "var(--hf-ink)" }} />
          <I h={10} w="90%" style={{ background: "var(--hf-ink)" }} />
          <I h={10} w="70%" style={{ background: "var(--hf-ink)" }} />
          <div style={{ display: "flex", gap: 4 }}>
            <I h={14} w={40} accent />
            <I h={14} w={40} accent />
          </div>
        </div>
      }
      good={
        <div className="hf-box" style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <I h={16} w="85%" style={{ background: "var(--hf-ink)" }} />
          <Lines n={2} />
          <div style={{ display: "flex", gap: 4 }}>
            <I h={14} w={44} accent />
            <I h={14} w={36} />
          </div>
        </div>
      }
    />
  );
}

/** 画像の切り抜き方 */
function ObjectFit() {
  const fits: [string, CSSProperties["objectFit"]][] = [
    [tr("Fill frame"), "cover"],
    [tr("Show all", "show_all_variant_1"), "contain"],
    [tr("Stretch", "stretch_variant_1"), "fill"],
  ];
  return (
    <div className="hf-row hf-wrap">
      {fits.map(([label, fit]) => (
        <div key={label} className="hf-col">
          <div className="hf-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={PHOTO} alt="" style={{ objectFit: fit }} />
          </div>
          <Label tone={fit === "fill" ? "bad" : fit === "cover" ? "accent" : undefined}>{label}</Label>
        </div>
      ))}
    </div>
  );
}

/** ボタンの状態 */
function States() {
  return (
    <div className="hf-row">
      <div className="hf-col">
        <span className="hf-btn">{tr("Sign up")}</span>
        <Label>{tr("Default")}</Label>
      </div>
      <div className="hf-col">
        <span className="hf-btn is-hover">
          {tr("Sign up")}
          <MousePointer2 size={12} className="hf-cursor" />
        </span>
        <Label tone="accent">{tr("Hover")}</Label>
      </div>
      <div className="hf-col">
        <span className="hf-btn is-press">{tr("Sign up")}</span>
        <Label>{tr("Pressed")}</Label>
      </div>
    </div>
  );
}

/** きっかけ → 動作 */
function ScriptBlocks() {
  return (
    <div className="hf-row">
      <div className="hf-script">
        <div className="hf-hat">
          <span className="hf-chip-in">{tr("Button")}</span>
          {tr("When clicked")}
        </div>
        <div className="hf-act">
          <span className="hf-chip-in">{tr("Contact")}</span>
          {tr("Open page")}
        </div>
      </div>
      <div className="hf-col" style={{ alignItems: "flex-start", gap: 6 }}>
        <Label tone="warn">{tr("Trigger (when)")}</Label>
        <Label tone="accent">{tr("Action (what to do)")}</Label>
        <Label>{tr("Drag below to attach")}</Label>
      </div>
    </div>
  );
}

/** メニューの開け閉め */
function ToggleMenu() {
  const phone = (open: boolean) => (
    <div className="hf-screen is-phone" style={{ height: 100, padding: 0, position: "relative", overflow: "hidden" }}>
      <div className="hf-sticky-head">
        <i />
        <span className={open ? "hf-menu-btn is-on" : "hf-menu-btn"}>
          <Menu size={9} />
        </span>
      </div>
      <div style={{ padding: 5 }}>
        <Lines n={5} />
      </div>
      {open && (
        <div className="hf-drawer">
          <Lines n={4} w="80%" />
        </div>
      )}
    </div>
  );
  return (
    <div className="hf-row">
      <div className="hf-col">
        {phone(false)}
        <Label>{tr("Hidden at first")}</Label>
      </div>
      <div className="hf-col">
        <Arrow />
        <Label>{tr("Click")}</Label>
      </div>
      <div className="hf-col">
        {phone(true)}
        <Label tone="accent">{tr("Toggle visibility")}</Label>
      </div>
    </div>
  );
}

/** データの一覧をリストで並べる */
function ListRepeat() {
  return (
    <div className="hf-row">
      <div className="hf-json">
        <span>[</span>
        <span className="in">{tr("{ title: New menu }")}</span>
        <span className="in">{tr("{ title: Opening hours }")}</span>
        <span className="in">{tr("{ title: Summer break }")}</span>
        <span>]</span>
      </div>
      <Arrow />
      <div className="hf-col" style={{ gap: 4 }}>
        <div className="hf-card is-tpl">
          <I h={20} />
          <span className="hf-tok">{"{title}"}</span>
        </div>
        <div className="hf-card is-ghost">
          <I h={20} />
          <span>{tr("Opening hours")}</span>
        </div>
        <div className="hf-card is-ghost">
          <I h={20} />
          <span>{tr("Summer break")}</span>
        </div>
      </div>
      <div className="hf-col" style={{ alignItems: "flex-start" }}>
        <Label tone="accent">{tr("The first is the template")}</Label>
        <Label>{tr("The rest follow automatically")}</Label>
      </div>
    </div>
  );
}

/** 1つのデザインから、1件ずつのページ */
function SlugPages() {
  return (
    <div className="hf-row">
      <div className="hf-col">
        <div className="hf-page is-tpl">
          <I h={22} />
          <Lines n={2} />
        </div>
        <Label tone="accent">events/[slug]</Label>
      </div>
      <Arrow />
      <div className="hf-col" style={{ gap: 4, alignItems: "flex-start" }}>
        {["/events/1", "/events/2", "/events/3"].map((u) => (
          <span key={u} className="hf-url">
            <FileText size={11} />
            {u}
          </span>
        ))}
        <Label>{tr("A page for each data item")}</Label>
      </div>
    </div>
  );
}

/** コンポーネントの使い回し */
function ComponentSync() {
  const page = (name: string) => (
    <div className="hf-col">
      <div className="hf-page">
        <div className="hf-inst" />
        <Lines n={3} />
      </div>
      <Label>{name}</Label>
    </div>
  );
  return (
    <div className="hf-row">
      <div className="hf-col">
        <div className="hf-master">
          <Pencil size={11} />
          {tr("Header")}
        </div>
        <Label tone="accent">{tr("Edit the main component")}</Label>
      </div>
      <Arrow />
      {page(tr("Page A"))}
      {page(tr("Page B"))}
      <Label tone="accent">{tr("Applies everywhere")}</Label>
    </div>
  );
}

/** 公開の流れ */
function PublishFlow() {
  return (
    <div className="hf-row hf-wrap">
      <div className="hf-node">{tr("Editor")}</div>
      <Arrow />
      <div className="hf-col" style={{ gap: 2 }}>
        <div className="hf-node is-test">{tr("Test site")}</div>
        <Label>{tr("For checking, hidden from search")}</Label>
      </div>
      <Arrow />
      <div className="hf-col" style={{ gap: 2 }}>
        <div className="hf-node is-prod">{tr("Live site")}</div>
        <Label>{tr("What visitors see")}</Label>
      </div>
    </div>
  );
}

/** フォルダとURLは別 */
function FoldersVsUrl() {
  return (
    <div className="hf-row" style={{ alignItems: "stretch" }}>
      <div className="hf-col" style={{ alignItems: "stretch", gap: 4 }}>
        <Label>{tr("Page list in the editor")}</Label>
        <div className="hf-tree">
          <span>
            <FileText size={11} />
            {tr("Home")}
          </span>
          <span>
            <Folder size={11} />
            {tr("News")}
          </span>
          <span className="in">
            <FileText size={11} />
            {tr("New menu")}
          </span>
          <span className="in">
            <FileText size={11} />
            {tr("Summer break")}
          </span>
        </div>
      </div>
      <Arrow />
      <div className="hf-col" style={{ alignItems: "stretch", gap: 4 }}>
        <Label>{tr("URLs on the live site")}</Label>
        <div className="hf-tree">
          <span>/</span>
          <span>/new-menu</span>
          <span>/summer-break</span>
          <span className="is-muted">{tr("Folder names don't appear")}</span>
        </div>
      </div>
    </div>
  );
}

/** 指で押しやすい大きさ */
function TapTarget() {
  return (
    <Compare
      badLabel={tr("Small (24px)")}
      goodLabel={tr("44px or more")}
      bad={
        <div className="hf-tap">
          <span className="hf-btn" style={{ height: 24, fontSize: 10, padding: "0 8px" }}>
            {tr("Submit")}
          </span>
          <span className="hf-finger" />
        </div>
      }
      good={
        <div className="hf-tap">
          <span className="hf-btn" style={{ height: 44, padding: "0 22px" }}>
            {tr("Submit")}
          </span>
          <span className="hf-finger" />
        </div>
      }
    />
  );
}

/** 影の付け方 */
function Shadow() {
  return (
    <Compare
      badLabel={tr("Dark, small blur")}
      goodLabel={tr("Light, large blur")}
      bad={
        <div className="hf-shadow-stage">
          <div className="hf-shadow" style={{ boxShadow: "3px 3px 2px rgba(0,0,0,0.55)" }} />
        </div>
      }
      good={
        <div className="hf-shadow-stage">
          <div className="hf-shadow" style={{ boxShadow: "0 6px 18px rgba(0,0,0,0.12)", borderRadius: 10 }} />
        </div>
      }
    />
  );
}

/** 外部データを取得して表示する */
function FetchData() {
  return (
    <div className="hf-row" style={{ gap: 14 }}>
      <div className="hf-col" style={{ gap: 4 }}>
        <span className="hf-url">https://…/news.json</span>
        <ArrowDown size={12} className="hf-arrow" />
        <div className="hf-json">
          <span>{"{"}</span>
          <span className="in">{tr("title: New menu")}</span>
          <span>{"}"}</span>
        </div>
        <Label>{tr("Fetch as \"news\"")}</Label>
      </div>
      <Arrow />
      <div className="hf-col" style={{ gap: 4 }}>
        <span className="hf-tok">{tr("{news.title}")}</span>
        <ArrowDown size={12} className="hf-arrow" />
        <strong className="hf-result">{tr("New menu")}</strong>
        <Label>{tr("Written in text, it becomes the value")}</Label>
      </div>
    </div>
  );
}

/** 代替テキスト */
function AltText() {
  return (
    <div className="hf-row">
      <div className="hf-fit" style={{ width: 96, height: 72 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={PHOTO} alt="" style={{ objectFit: "cover" }} />
      </div>
      <Arrow />
      <div className="hf-bubble">
        <span>{tr("Read aloud, or shown if the image fails")}</span>
        {tr("\"A photo of a mountain under a blue sky\"")}
      </div>
    </div>
  );
}

/** クリックするたびに1階層ずつ内側を選ぶ（⌘クリックは最も内側） */
function SelectDepth() {
  const step = (sel: 0 | 1 | 2, label: string, sub: string) => (
    <div className="hf-col" style={{ gap: 4 }}>
      <div className={`hf-box hf-sd${sel === 0 ? " is-sel" : ""}`}>
        <div className={`hf-box hf-sd-card${sel === 1 ? " is-sel" : ""}`}>
          <span className={`hf-sd-text${sel === 2 ? " is-sel" : ""}`}>
            <Lines n={1} dark />
          </span>
          <Lines n={2} />
          {sel !== 2 && <MousePointer2 size={13} className="hf-sd-ptr" />}
        </div>
      </div>
      <Label tone={sel === 2 ? "accent" : undefined}>{label}</Label>
      <Label>{sub}</Label>
    </div>
  );
  return (
    <div className="hf-row hf-wrap" style={{ alignItems: "flex-start" }}>
      {step(0, tr("1st click"), tr("Outermost"))}
      <Arrow />
      {step(1, tr("2nd click"), tr("One level in"))}
      <Arrow />
      {step(2, tr("3rd click / ⌘-click"), tr("Innermost"))}
    </div>
  );
}

/** 追加する位置: 中へ / 後ろへ */
function InsertMode() {
  const box = (inside: boolean) => (
    <div className="hf-col" style={{ alignItems: "stretch", gap: 4, width: 132 }}>
      <div className="hf-box is-sel" style={{ padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="hf-tag">{tr("Selected box")}</span>
        <I h={8} w="80%" />
        <I h={8} w="60%" />
        {inside && <I h={10} accent />}
      </div>
      {!inside && <I h={10} accent />}
    </div>
  );
  return (
    <div className="hf-row hf-wrap" style={{ alignItems: "flex-start", gap: 20 }}>
      <div className="hf-col">
        {box(true)}
        <Label tone="accent">{tr("Inside: end of the box")}</Label>
      </div>
      <div className="hf-col">
        {box(false)}
        <Label tone="accent">{tr("After: right after (same level)")}</Label>
      </div>
    </div>
  );
}

/** 1つのリポジトリの2つのブランチで、テストと本番を分ける */
function BranchPublish() {
  return (
    <div className="hf-col" style={{ alignItems: "stretch", gap: 8, width: "100%" }}>
      <div className="hf-row" style={{ justifyContent: "center", gap: 10 }}>
        <div className="hf-node">{tr("Editor")}</div>
        <Arrow />
        <div className="hf-box hf-repo">
          <span className="hf-tag">{tr("GitHub repository")}</span>
          <span className="hf-branch is-test">preview</span>
          <span className="hf-branch is-prod">main</span>
        </div>
        <Arrow />
        <div className="hf-col" style={{ alignItems: "stretch", gap: 6 }}>
          <div className="hf-node is-test">{tr("Preview URL")}</div>
          <div className="hf-node is-prod">{tr("Your domain")}</div>
        </div>
      </div>
      <Label wrap>{tr("Vercel, Cloudflare and Netlify automatically publish non-production branches as preview environments.")}</Label>
    </div>
  );
}

/** ロールバックは「前の版と同じ内容」を新しいコミットとして積む */
function Rollback() {
  const v = (n: string, opts: { current?: boolean; copy?: boolean; dim?: boolean } = {}) => (
    <div className="hf-col" style={{ gap: 3 }}>
      <span className={`hf-commit${opts.current ? " is-current" : ""}${opts.copy ? " is-copy" : ""}${opts.dim ? " is-dim" : ""}`}>{n}</span>
    </div>
  );
  return (
    <div className="hf-col" style={{ gap: 6 }}>
      <div className="hf-row hf-commits">
        {v(tr("v1"))}
        <i />
        {v(tr("v2"))}
        <i />
        {v(tr("v3"), { dim: true })}
        <i />
        {v(tr("Same as v2"), { current: true, copy: true })}
      </div>
      <Label wrap>{tr("\"Restore site\" keeps the history and publishes the chosen version's content again as a new version. You can undo the restore itself later, too.")}</Label>
    </div>
  );
}

/** AIに頼む流れ */
function AiFlow() {
  return (
    <div className="hf-row hf-wrap" style={{ gap: 10 }}>
      <div className="hf-bubble">{tr("Make the heading bigger and center it")}</div>
      <Arrow />
      <div className="hf-col" style={{ gap: 3 }}>
        <div className="hf-node">{tr("AI edits")}</div>
        <Label>{tr("Text size and alignment")}</Label>
      </div>
      <Arrow />
      <div className="hf-col" style={{ gap: 3 }}>
        <div className="hf-node is-prod">⌘Z</div>
        <Label>{tr("Undo it all at once")}</Label>
      </div>
    </div>
  );
}

/** ページを複数選んで、まとめて操作する */
function PageMulti() {
  return (
    <div className="hf-col" style={{ alignItems: "stretch", gap: 4, width: 220 }}>
      <div className="hf-bulk">
        <X size={10} />
        <b>{tr("2 selected")}</b>
        <Folder size={11} />
        <Pencil size={11} style={{ opacity: 0 }} />
      </div>
      <div className="hf-tree">
        <span>
          <i className="hf-check" />
          {tr("Home")}
        </span>
        <span className="is-picked">
          <i className="hf-check is-on" />
          {tr("Summer closure notice")}
        </span>
        <span className="is-picked">
          <i className="hf-check is-on" />
          {tr("New menu")}
        </span>
        <span>
          <i className="hf-check" />
          {tr("About us")}
        </span>
      </div>
      <Label>{tr("⌘-click picks one, Shift-click picks a range")}</Label>
    </div>
  );
}

const FIGURES = {
  "editor-map": EditorMap,
  "flow-modes": FlowModes,
  "parent-row": ParentRow,
  "align-center": AlignCenter,
  "gap-vs-margin": GapVsMargin,
  "box-model": BoxModel,
  "width-percent": WidthPercent,
  "max-width": MaxWidth,
  "grid-responsive": GridResponsive,
  "stack-mobile": StackOnMobile,
  wrap: Wrap,
  "position-custom": PositionCustom,
  sticky: Sticky,
  "min-height-vh": MinHeightVh,
  "units-compare": UnitsCompare,
  "fixed-height": FixedHeight,
  "flow-vs-absolute": FlowVsAbsolute,
  "breakpoint-cascade": BreakpointCascade,
  "device-visibility": DeviceVisibility,
  "heading-outline": HeadingOutline,
  "type-scale": TypeScale,
  "spacing-scale": SpacingScale,
  "color-ratio": ColorRatio,
  "line-length": LineLength,
  hierarchy: Hierarchy,
  "object-fit": ObjectFit,
  states: States,
  "script-blocks": ScriptBlocks,
  "toggle-menu": ToggleMenu,
  "list-repeat": ListRepeat,
  "slug-pages": SlugPages,
  "component-sync": ComponentSync,
  "publish-flow": PublishFlow,
  "folders-vs-url": FoldersVsUrl,
  "tap-target": TapTarget,
  shadow: Shadow,
  "fetch-data": FetchData,
  "alt-text": AltText,
  "select-depth": SelectDepth,
  "insert-mode": InsertMode,
  "branch-publish": BranchPublish,
  rollback: Rollback,
  "ai-flow": AiFlow,
  "page-multi": PageMulti,
} satisfies Record<string, () => ReactNode>;

export type FigureId = keyof typeof FIGURES;

/** 図解（キャプション付き） */
export default function HelpFigure({ id, caption }: { id: FigureId; caption?: string }) {
  const F = FIGURES[id];
  if (!F) return null;
  return (
    <figure className="hf" aria-label={caption}>
      <div className="hf-body">
        <F />
      </div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
