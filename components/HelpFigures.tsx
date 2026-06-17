/**
 * ヘルプの記事に入れる図解。並べ方・余白・画像の切り抜きなどは、説明している CSS を
 * そのまま使って描く（図そのものが実際の見え方の見本になる）
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
        <b>{tr("上のバー")}</b>{tr("画面幅・プレビュー・公開")}
      </div>
      <div className="hf-ed-main">
        <div className="hf-ed-side">
          <b>{tr("左パネル")}</b>
          <span>{tr("置く・選ぶ")}</span>
          <Lines n={4} w="80%" />
        </div>
        <div className="hf-ed-canvas">
          <b>{tr("キャンバス")}</b>
          <span>{tr("見る・クリックで選ぶ")}</span>
          <div className="hf-ed-page">
            <I h={6} w="40%" />
            <I h={18} w="70%" accent />
            <I h={6} w="55%" />
          </div>
        </div>
        <div className="hf-ed-side">
          <b>{tr("右パネル")}</b>
          <span>{tr("選んだものを変える")}</span>
          <Lines n={4} />
        </div>
      </div>
    </div>
  );
}

/** フローの4種類 */
function FlowModes() {
  const modes: [string, string][] = [
    [tr("自動"), "block"],
    [tr("垂直フロー"), "col"],
    [tr("水平フロー"), "row"],
    [tr("グリッド"), "grid"],
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
        <Label>{tr("垂直フロー（↓）")}</Label>
      </div>
      <Arrow />
      <div className="hf-col">
        <div className="hf-box is-sel hf-flow is-row hf-flow-lg">
          <i />
          <i />
          <i />
        </div>
        <Label>{tr("水平フロー（→）")}</Label>
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

/** 子ごとの外側余白より、親の間隔 */
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
      badLabel={tr("子ごとに外側余白")}
      goodLabel={tr("親の「間隔」でまとめて")}
      bad={row([6, 24])}
      good={row([16, 16], true)}
    />
  );
}

/** 内側余白と外側余白 */
function BoxModel() {
  return (
    <div className="hf-row">
      <div className="hf-bm">
        <span className="hf-bm-name">{tr("外側余白")}</span>
        <div className="hf-bm-border">
          <span className="hf-bm-name is-in">{tr("内側余白")}</span>
          <div className="hf-bm-content">{tr("中身")}</div>
        </div>
      </div>
      <div className="hf-col" style={{ alignItems: "flex-start", gap: 8 }}>
        <span className="hf-key">
          <i className="is-in" />
          {tr("内側余白：枠の内側。背景色が付く")}
        </span>
        <span className="hf-key">
          <i className="is-out" />
          {tr("外側余白：枠の外側。背景色は付かない")}
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
        <Label tone="accent">{tr("幅 50% = 親の半分")}</Label>
        <Label>{tr("親の幅が変わっても半分のまま")}</Label>
      </div>
      <div className="hf-box" style={{ padding: 6, width: "100%", display: "flex", gap: 6 }}>
        <I w={28} h={20} />
        <I h={20} accent style={{ flex: 1 }} />
      </div>
      <Label tone="accent">{tr("「残りを埋める」= 隣の要素の残りすべて")}</Label>
    </div>
  );
}

/** 背景は画面いっぱい・中身は最大幅で中央 */
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
        <Label>{tr("背景の帯：画面いっぱい")}</Label>
        <Label tone="accent">{tr("中身：最大幅を付けて中央")}</Label>
      </div>
    </div>
  );
}

/** パソコン3列 → スマホ1列 */
function GridResponsive() {
  return (
    <div className="hf-row" style={{ alignItems: "flex-end" }}>
      <Screen kind="pc" label={tr("パソコン：3列")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5 }}>
          <I h={34} />
          <I h={34} />
          <I h={34} />
        </div>
      </Screen>
      <Arrow />
      <Screen kind="phone" label={<span className="is-warn-text">{tr("スマホ：1列")}</span>}>
        <div style={{ display: "grid", gap: 5 }}>
          <I h={22} />
          <I h={22} />
          <I h={22} />
        </div>
      </Screen>
    </div>
  );
}

/** 横並びをスマホでは縦に */
function StackOnMobile() {
  return (
    <div className="hf-row" style={{ alignItems: "flex-end" }}>
      <Screen kind="pc" label={tr("パソコン：水平フロー")}>
        <div className="hf-box is-sel" style={{ display: "flex", gap: 5, padding: 5 }}>
          <I h={30} style={{ flex: 1 }} />
          <I h={30} style={{ flex: 1 }} />
          <I h={30} style={{ flex: 1 }} />
        </div>
      </Screen>
      <Arrow />
      <Screen kind="phone" label={<span className="is-warn-text">{tr("スマホだけ垂直フロー")}</span>}>
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
  return <Compare badLabel={tr("折り返さない（はみ出す）")} goodLabel={tr("折り返す")} bad={<div className="hf-clipx">{box(false)}</div>} good={box(true)} />;
}

/** 自由な位置（カスタム）は親が基準 */
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
          {tr("X・Y は親（青い枠）からの距離")}
        </Label>
        <Label wrap>{tr("ほかの要素は、バッジが無いものとして並ぶ")}</Label>
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
        <Label>{tr("ページの上")}</Label>
      </div>
      <div className="hf-col">
        <Arrow down />
        <Label>{tr("スクロール")}</Label>
      </div>
      <div className="hf-col">
        {page(true)}
        <Label tone="accent">{tr("ヘッダーは上に残る")}</Label>
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
        <Label tone="accent">{tr("最小高さ 100vh")}</Label>
        <Label>{tr("= 画面の高さちょうど")}</Label>
        <Label>{tr("中身が多ければ伸びる")}</Label>
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
        <Label>{tr("パソコン")}</Label>
      </div>
      <div className="hf-col">
        <div className="hf-screen is-phone" style={{ width: 40, overflow: "visible" }}>
          {fixed ? <I h={16} w={58} style={{ background: "var(--hf-bad)", opacity: 0.8 }} /> : <I h={16} w="100%" accent />}
        </div>
        <Label tone={fixed ? "bad" : "good"}>{tr("スマホ")}</Label>
      </div>
    </div>
  );
  return <Compare badLabel={tr("幅 800px")} goodLabel={tr("幅 100% ＋ 最大幅 800px")} bad={pair(true)} good={pair(false)} />;
}

/** 高さを固定すると、文字があふれる */
function FixedHeight() {
  return (
    <Compare
      badLabel={tr("高さ 60px に固定")}
      goodLabel={tr("高さは空欄（中身に合わせる）")}
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

/** 自由配置は狭い画面で重なる */
function FlowVsAbsolute() {
  return (
    <Compare
      badLabel={tr("X・Y で配置（スマホ）")}
      goodLabel={tr("フローで並べる（スマホ）")}
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
    [tr("スマホ"), "〜478", 20],
    [tr("スマホ横"), "〜767", 22],
    [tr("タブレット"), "〜1024", 24],
    [tr("パソコン"), "1025〜", 34],
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
      <div className="hf-bp-bar is-base">{tr("パソコンで決めた設定 → すべての画面に効く")}</div>
      <div className="hf-bp-bar is-bp" style={{ width: "21%" }}>
        {tr("スマホで上書き")}
      </div>
      <Label>{tr("小さい画面の設定ほど優先。変えた所だけ上書きする")}</Label>
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
        <Label>{tr("スマホだけオフ")}</Label>
      </div>
      <Arrow />
      <Screen kind="pc" label={tr("表示")} style={{ width: 92 }}>
        <I h={10} w="60%" />
        <I h={20} accent style={{ marginTop: 5 }} />
      </Screen>
      <Screen kind="phone" label={<span className="is-warn-text">{tr("表示しない")}</span>}>
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
      <span className="hf-h-tag">{tr("見出し{n}", { n: lv })}</span>
      <span className="hf-h-name">{label}</span>
      <span className="hf-h-desc">{desc}</span>
    </div>
  );
  return (
    <div className="hf-stack" style={{ alignItems: "stretch" }}>
      {row(1, tr("ひだまりカフェ"), tr("ページの題名・1つだけ"))}
      {row(2, tr("お店について"), tr("区切り"))}
      {row(3, tr("アクセス"), tr("さらに細かく"))}
      {row(2, tr("メニュー"), tr("区切り"))}
      <div className="hf-h-note">
        <X size={12} strokeWidth={2.6} />
        {tr("見出し2 の次に いきなり見出し4（段を飛ばす）")}
      </div>
    </div>
  );
}

/** 文字サイズの段階 */
function TypeScale() {
  const rows: [string, number][] = [
    [tr("見出し1"), 44],
    [tr("見出し2"), 30],
    [tr("見出し3"), 22],
    [tr("本文"), 16],
    [tr("注釈"), 12],
  ];
  return (
    <div className="hf-stack" style={{ alignItems: "stretch", gap: 2 }}>
      {rows.map(([name, px]) => (
        <div key={name} className="hf-type">
          <span className="hf-type-name">{name}</span>
          <span className="hf-type-sample" style={{ fontSize: Math.round(px * 0.6), fontWeight: px >= 22 ? 700 : 400 }}>
            {tr("カフェへようこそ")}
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
        <Label>{tr("使う数を決めておく")}</Label>
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
        <Label>{tr("まとまりの中は狭く、外は広く")}</Label>
      </div>
    </div>
  );
}

/** 色の割合とコントラスト */
function ColorRatio() {
  const roles: [string, string, number, string][] = [
    [tr("ベース"), "#ffffff", 70, tr("背景・広い面")],
    [tr("メイン"), "#3b6fd8", 25, tr("見出し・帯・ロゴ")],
    [tr("アクセント"), "#f08c2b", 5, tr("ボタンなど押してほしいもの")],
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
            {tr("読みやすい")}
          </span>
          <span className="hf-contrast" style={{ color: "#c4c8ce" }}>
            <X size={12} strokeWidth={2.6} className="is-bad" />
            {tr("読みにくい")}
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
      badLabel={tr("画面いっぱいに広がる")}
      goodLabel={tr("最大幅で1行を35〜45文字に")}
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
      badLabel={tr("全部が同じ強さ")}
      goodLabel={tr("主役が1つ")}
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
    [tr("枠を埋める"), "cover"],
    [tr("全体を表示"), "contain"],
    [tr("引き伸ばす"), "fill"],
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
        <span className="hf-btn">{tr("申し込む")}</span>
        <Label>{tr("既定")}</Label>
      </div>
      <div className="hf-col">
        <span className="hf-btn is-hover">
          {tr("申し込む")}
          <MousePointer2 size={12} className="hf-cursor" />
        </span>
        <Label tone="accent">{tr("ホバー")}</Label>
      </div>
      <div className="hf-col">
        <span className="hf-btn is-press">{tr("申し込む")}</span>
        <Label>{tr("押したとき")}</Label>
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
          <span className="hf-chip-in">{tr("ボタン")}</span>
          {tr("クリックしたとき")}
        </div>
        <div className="hf-act">
          <span className="hf-chip-in">{tr("お問い合わせ")}</span>
          {tr("ページを開く")}
        </div>
      </div>
      <div className="hf-col" style={{ alignItems: "flex-start", gap: 6 }}>
        <Label tone="warn">{tr("きっかけ（いつ）")}</Label>
        <Label tone="accent">{tr("動作（何をする）")}</Label>
        <Label>{tr("下へドラッグしてつなげる")}</Label>
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
        <Label>{tr("最初は隠す")}</Label>
      </div>
      <div className="hf-col">
        <Arrow />
        <Label>{tr("押す")}</Label>
      </div>
      <div className="hf-col">
        {phone(true)}
        <Label tone="accent">{tr("表示を切り替える")}</Label>
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
        <span className="in">{tr("{ title: 新メニュー }")}</span>
        <span className="in">{tr("{ title: 営業時間 }")}</span>
        <span className="in">{tr("{ title: 夏季休業 }")}</span>
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
          <span>{tr("営業時間")}</span>
        </div>
        <div className="hf-card is-ghost">
          <I h={20} />
          <span>{tr("夏季休業")}</span>
        </div>
      </div>
      <div className="hf-col" style={{ alignItems: "flex-start" }}>
        <Label tone="accent">{tr("1つ目がお手本")}</Label>
        <Label>{tr("残りは自動で並ぶ")}</Label>
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
        <Label>{tr("データの1件ごとにページができる")}</Label>
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
          {tr("ヘッダー")}
        </div>
        <Label tone="accent">{tr("マスターを直す")}</Label>
      </div>
      <Arrow />
      {page(tr("ページA"))}
      {page(tr("ページB"))}
      <Label tone="accent">{tr("全部に反映")}</Label>
    </div>
  );
}

/** 公開の流れ */
function PublishFlow() {
  return (
    <div className="hf-row hf-wrap">
      <div className="hf-node">{tr("エディタ")}</div>
      <Arrow />
      <div className="hf-col" style={{ gap: 2 }}>
        <div className="hf-node is-test">{tr("テストサイト")}</div>
        <Label>{tr("確認用・検索に出ない")}</Label>
      </div>
      <Arrow />
      <div className="hf-col" style={{ gap: 2 }}>
        <div className="hf-node is-prod">{tr("本番サイト")}</div>
        <Label>{tr("訪問者が見る")}</Label>
      </div>
    </div>
  );
}

/** フォルダとURLは別 */
function FoldersVsUrl() {
  return (
    <div className="hf-row" style={{ alignItems: "stretch" }}>
      <div className="hf-col" style={{ alignItems: "stretch", gap: 4 }}>
        <Label>{tr("エディタのページ一覧")}</Label>
        <div className="hf-tree">
          <span>
            <FileText size={11} />
            {tr("ホーム")}
          </span>
          <span>
            <Folder size={11} />
            {tr("お知らせ")}
          </span>
          <span className="in">
            <FileText size={11} />
            {tr("新メニュー")}
          </span>
          <span className="in">
            <FileText size={11} />
            {tr("夏季休業")}
          </span>
        </div>
      </div>
      <Arrow />
      <div className="hf-col" style={{ alignItems: "stretch", gap: 4 }}>
        <Label>{tr("公開サイトのURL")}</Label>
        <div className="hf-tree">
          <span>/</span>
          <span>/new-menu</span>
          <span>/summer-break</span>
          <span className="is-muted">{tr("フォルダ名は出ない")}</span>
        </div>
      </div>
    </div>
  );
}

/** 指で押しやすい大きさ */
function TapTarget() {
  return (
    <Compare
      badLabel={tr("小さい（24px）")}
      goodLabel={tr("44px 以上")}
      bad={
        <div className="hf-tap">
          <span className="hf-btn" style={{ height: 24, fontSize: 10, padding: "0 8px" }}>
            {tr("送信")}
          </span>
          <span className="hf-finger" />
        </div>
      }
      good={
        <div className="hf-tap">
          <span className="hf-btn" style={{ height: 44, padding: "0 22px" }}>
            {tr("送信")}
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
      badLabel={tr("濃く・小さいぼかし")}
      goodLabel={tr("薄く・大きいぼかし")}
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
          <span className="in">{tr("title: 新メニュー")}</span>
          <span>{"}"}</span>
        </div>
        <Label>{tr("取得して「お知らせ」とする")}</Label>
      </div>
      <Arrow />
      <div className="hf-col" style={{ gap: 4 }}>
        <span className="hf-tok">{tr("{お知らせ.title}")}</span>
        <ArrowDown size={12} className="hf-arrow" />
        <strong className="hf-result">{tr("新メニュー")}</strong>
        <Label>{tr("文字に書くと値になる")}</Label>
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
        <span>{tr("読み上げ・画像が出ないとき")}</span>
        {tr("「山と青空の写真」")}
      </div>
    </div>
  );
}


/** クリックするたびに1階層ずつ奥を選ぶ（⌘クリックは一番奥） */
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
      {step(0, tr("1回目"), tr("いちばん外側"))}
      <Arrow />
      {step(1, tr("2回目"), tr("1つ内側"))}
      <Arrow />
      {step(2, tr("3回目 / ⌘クリック"), tr("いちばん奥"))}
    </div>
  );
}

/** 追加する位置: 中へ / 後ろへ */
function InsertMode() {
  const box = (inside: boolean) => (
    <div className="hf-col" style={{ alignItems: "stretch", gap: 4, width: 132 }}>
      <div className="hf-box is-sel" style={{ padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="hf-tag">{tr("選んだボックス")}</span>
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
        <Label tone="accent">{tr("中へ: ボックスの中の最後")}</Label>
      </div>
      <div className="hf-col">
        {box(false)}
        <Label tone="accent">{tr("後ろへ: すぐ後ろ（同じ階層）")}</Label>
      </div>
    </div>
  );
}

/** 1つのリポジトリの2つのブランチで、テストと本番を分ける */
function BranchPublish() {
  return (
    <div className="hf-col" style={{ alignItems: "stretch", gap: 8, width: "100%" }}>
      <div className="hf-row" style={{ justifyContent: "center", gap: 10 }}>
        <div className="hf-node">{tr("エディタ")}</div>
        <Arrow />
        <div className="hf-box hf-repo">
          <span className="hf-tag">{tr("GitHubリポジトリ")}</span>
          <span className="hf-branch is-test">preview</span>
          <span className="hf-branch is-prod">main</span>
        </div>
        <Arrow />
        <div className="hf-col" style={{ alignItems: "stretch", gap: 6 }}>
          <div className="hf-node is-test">{tr("プレビューURL")}</div>
          <div className="hf-node is-prod">{tr("公開ドメイン")}</div>
        </div>
      </div>
      <Label wrap>{tr("Vercel・Cloudflare・Netlify は、本番以外のブランチを自動でプレビュー環境として公開します。")}</Label>
    </div>
  );
}

/** ロールバックは「前の版と同じ内容」を新しく積む */
function Rollback() {
  const v = (n: string, opts: { current?: boolean; copy?: boolean; dim?: boolean } = {}) => (
    <div className="hf-col" style={{ gap: 3 }}>
      <span className={`hf-commit${opts.current ? " is-current" : ""}${opts.copy ? " is-copy" : ""}${opts.dim ? " is-dim" : ""}`}>{n}</span>
    </div>
  );
  return (
    <div className="hf-col" style={{ gap: 6 }}>
      <div className="hf-row hf-commits">
        {v(tr("版1"))}
        <i />
        {v(tr("版2"))}
        <i />
        {v(tr("版3"), { dim: true })}
        <i />
        {v(tr("版2と同じ"), { current: true, copy: true })}
      </div>
      <Label wrap>{tr("「サイトを戻す」は履歴を消さずに、選んだ版と同じ内容を新しく公開します。戻したこと自体も、あとから戻せます。")}</Label>
    </div>
  );
}

/** AIに頼む流れ */
function AiFlow() {
  return (
    <div className="hf-row hf-wrap" style={{ gap: 10 }}>
      <div className="hf-bubble">{tr("見出しを大きく、中央寄せにして")}</div>
      <Arrow />
      <div className="hf-col" style={{ gap: 3 }}>
        <div className="hf-node">{tr("AIが編集")}</div>
        <Label>{tr("文字の大きさ・そろえ方")}</Label>
      </div>
      <Arrow />
      <div className="hf-col" style={{ gap: 3 }}>
        <div className="hf-node is-prod">⌘Z</div>
        <Label>{tr("まとめて取り消せる")}</Label>
      </div>
    </div>
  );
}

/** ページを複数選んでまとめて操作 */
function PageMulti() {
  return (
    <div className="hf-col" style={{ alignItems: "stretch", gap: 4, width: 220 }}>
      <div className="hf-bulk">
        <X size={10} />
        <b>{tr("2件を選択")}</b>
        <Folder size={11} />
        <Pencil size={11} style={{ opacity: 0 }} />
      </div>
      <div className="hf-tree">
        <span>
          <i className="hf-check" />
          {tr("ホーム")}
        </span>
        <span className="is-picked">
          <i className="hf-check is-on" />
          {tr("夏季休業のお知らせ")}
        </span>
        <span className="is-picked">
          <i className="hf-check is-on" />
          {tr("新メニュー")}
        </span>
        <span>
          <i className="hf-check" />
          {tr("会社概要")}
        </span>
      </div>
      <Label>{tr("⌘クリックで1件ずつ、Shiftクリックで範囲を選ぶ")}</Label>
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

export const FIGURE_IDS = Object.keys(FIGURES) as FigureId[];

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
