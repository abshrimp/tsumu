"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, Lightbulb, MousePointerClick, X } from "lucide-react";
import { useEditor } from "../lib/store";
import { BP_ORDER } from "../lib/style";
import { canContainElements } from "../lib/tags";
import { TOPIC_BY_ID, type EditorState, type GuideStep, type SelectionNeed, type Topic } from "../lib/manual";
import { setGuideStep, stopGuide, useHelp } from "../lib/help";
import { glyphs } from "./Glyph";
import { tr } from "../lib/i18n";

/** 選択が手順の条件を満たしているか */
function needMet(s: EditorState, need: SelectionNeed | undefined): boolean {
  if (!need) return true;
  const n = s.selection ? s.doc.nodes[s.selection] : undefined;
  if (!n) return false;
  if (need === "image") return n.type === "image";
  if (need === "text") return n.type === "box" && !!n.text && !n.children.length;
  if (need === "container") return canContainElements(n);
  return true;
}

const NEED_TEXT: Record<SelectionNeed, string> = {
  any: tr("まず、操作したい要素をキャンバスかレイヤーでクリックして選んでください。"),
  text: tr("まず、文字（テキスト・見出し・ボタン）をクリックして選んでください。"),
  image: tr("まず、画像をクリックして選んでください。"),
  container: tr("まず、中に要素を入れているボックス（親）を選んでください。中の要素を選んでいるときは ⇧Enter で親を選べます。"),
};

/** いちばん小さいブレークポイント（スマホ）のID */
function mobileBp(): string | null {
  return BP_ORDER.length > 1 ? BP_ORDER[BP_ORDER.length - 1] : null;
}

function resolveTarget(target: string | undefined): string | undefined {
  if (!target) return undefined;
  if (!target.includes("{mobile}")) return target;
  const bp = mobileBp();
  return bp ? target.replace("{mobile}", bp) : undefined;
}

function findTarget(target: string | undefined): HTMLElement | null {
  if (!target) return null;
  // 同じ名前が複数あるとき（選んでいる要素が複数など）は、画面に見えている最初のもの
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tutorial="${CSS.escape(target)}"]`));
  return all.find((el) => el.getClientRects().length > 0) ?? null;
}

/** 案内する場所が左右どちらのパネルにあるか（閉じていれば開く） */
function panelOf(target: string | undefined, step: GuideStep): "l" | "r" | null {
  if (step.prepare?.left) return "l";
  if (step.prepare?.right || step.prepare?.deselect) return "r";
  if (!target) return null;
  if (/^(left-|add-|pages-panel|layers|layer-|asset|site-|insert-target)/.test(target)) return "l";
  if (/^(inspector|right-tab|style-|settings-|page-|tutorial-page)/.test(target)) return "r";
  return null;
}

function openSection(name: string): boolean {
  const sec = document.querySelector<HTMLElement>(`[data-tutorial="${CSS.escape(name)}"]`);
  if (!sec) return false;
  const head = sec.querySelector<HTMLElement>(":scope > .sec-head");
  if (head && !head.classList.contains("is-open")) {
    sec.querySelector<HTMLElement>(":scope > .sec-head .sec-title")?.click();
  }
  return true;
}

/** 手順を始めるときの画面の準備 */
function prepareStep(step: GuideStep, target: string | undefined) {
  const s = useEditor.getState();
  const p = step.prepare ?? {};
  if ((p.design || p.left || p.right || p.deselect) && s.mode !== "design") s.setMode("design");
  if (p.closeScripts && s.scriptEditor) s.openScriptEditor(null);
  if (p.deselect && s.selection) s.select(null);
  if (p.left && s.leftTab !== p.left) s.setLeftTab(p.left);
  if (p.right && s.rightTab !== p.right) s.setRightTab(p.right);
  const side = panelOf(target, step);
  if (side) window.dispatchEvent(new CustomEvent("tsumu-open-panel", { detail: side }));
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const GAP = 14;
const EDGE = 12;

/** カードの置き場所（場所の横・下・上のうち、はみ出さずに入るところ） */
function placeCard(rect: Rect | null, w: number, h: number): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampTop = (t: number) => Math.max(EDGE, Math.min(vh - h - EDGE, t));
  const clampLeft = (l: number) => Math.max(EDGE, Math.min(vw - w - EDGE, l));
  if (!rect) return { top: vh - h - 56, left: (vw - w) / 2 };
  const right = rect.left + rect.width + GAP;
  const left = rect.left - w - GAP;
  const below = rect.top + rect.height + GAP;
  const above = rect.top - h - GAP;
  const cx = rect.left + rect.width / 2 - w / 2;
  const cy = rect.top + rect.height / 2 - h / 2;
  const fitsRight = right + w <= vw - EDGE;
  const fitsLeft = left >= EDGE;
  const fitsBelow = below + h <= vh - EDGE;
  const fitsAbove = above >= EDGE;
  const center = rect.left + rect.width / 2;
  // 画面の左寄りの場所はその右に、右寄りの場所はその左に（パネルの中を隠さないように）
  if (center < vw * 0.4 && fitsRight) return { top: clampTop(cy), left: right };
  if (center > vw * 0.6 && fitsLeft) return { top: clampTop(cy), left };
  if (fitsBelow) return { top: below, left: clampLeft(cx) };
  if (fitsAbove) return { top: above, left: clampLeft(cx) };
  if (fitsRight) return { top: clampTop(cy), left: right };
  if (fitsLeft) return { top: clampTop(cy), left };
  // どこにも入らない大きな場所（キャンバスなど）は、その中の下の方に重ねる
  return { top: clampTop(rect.top + rect.height - h - 24), left: clampLeft(cx) };
}

export default function GuideOverlay() {
  const guide = useHelp((s) => s.guide);
  const topic = guide ? TOPIC_BY_ID[guide.topicId] : undefined;
  if (!guide || !topic?.guide?.length) return null;
  return <GuideRun key={topic.id} topic={topic} index={Math.min(guide.step, topic.guide.length - 1)} />;
}

function GuideRun({ topic, index }: { topic: Topic; index: number }) {
  const steps = topic.guide!;
  const step = steps[index];
  const last = index === steps.length - 1;
  const ready = useEditor((s) => needMet(s, step.needs));
  // 「キャンバスで〇〇を選ぶ」だけの手順は、選べたら済んだことにする
  const selectStep = !!step.needs && step.target === "canvas" && !step.done;
  const checks = !!step.done || selectStep;
  const done = useEditor((s) => ready && (step.done ? step.done(s) : selectStep));
  const stepTarget = resolveTarget(step.target);
  // 必要な選択がまだなら、選ぶ場所（キャンバス）を示す
  const target = ready ? stepTarget : "canvas";
  const missingBp = !!step.target?.includes("{mobile}") && !stepTarget;

  const [rect, setRect] = useState<Rect | null>(null);
  const [found, setFound] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 360, h: 200 });

  // 手順に合わせて画面を整える（必要な選択がそろってから）
  useEffect(() => {
    if (!ready) return;
    prepareStep(step, stepTarget);
    const section = step.prepare?.section;
    if (!section) return;
    // パネルやタブの切り替え後に描画されるので、出てくるまで少し待って開く
    let tries = 0;
    const timer = window.setInterval(() => {
      if (openSection(section) || ++tries > 20) window.clearInterval(timer);
    }, 80);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, ready]);

  // 示す場所を見える位置までスクロールし、動きに合わせて枠を追いかける
  useEffect(() => {
    let raf = 0;
    let scrolled = false;
    let missing = 0;
    const tick = () => {
      const el = findTarget(target);
      if (el) {
        if (!scrolled) {
          scrolled = true;
          el.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
        const r = el.getBoundingClientRect();
        const next = { top: r.top, left: r.left, width: r.width, height: r.height };
        setRect((prev) =>
          prev &&
          Math.abs(prev.top - next.top) < 0.5 &&
          Math.abs(prev.left - next.left) < 0.5 &&
          Math.abs(prev.width - next.width) < 0.5 &&
          Math.abs(prev.height - next.height) < 0.5
            ? prev
            : next
        );
        missing = 0;
        setFound(true);
      } else {
        // パネルの開閉の途中などで一瞬見えないだけのことがあるので、しばらく待ってから知らせる
        if (++missing > 30) setFound(false);
        setRect(null);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, index]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 操作が済んだら、少し見せてから次の手順へ
  useEffect(() => {
    if (!done || last) return;
    const t = window.setTimeout(() => setGuideStep(index + 1), 700);
    return () => window.clearTimeout(t);
  }, [done, last, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (document.querySelector(".dd-menu, .color-pop, .modal-backdrop:not(.is-leaving), [data-se-popover], .help")) {
        return;
      }
      stopGuide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pos = placeCard(rect, size.w, size.h);
  const ring = rect
    ? { top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }
    : null;

  return (
    <div className="guide" aria-live="polite">
      {ring && <div className="guide-ring" style={ring} />}
      <div
        ref={cardRef}
        className="guide-card"
        role="dialog"
        aria-modal="false"
        aria-label={tr("操作ガイド: {q}", { q: topic.q })}
        style={{ top: pos.top, left: pos.left }}
      >
        <button type="button" className="guide-close" aria-label={tr("案内を終える")} data-tip={tr("案内を終える（Esc）")} onClick={() => stopGuide()}>
          <X size={14} />
        </button>
        <div className="guide-eyebrow">
          <b>
            {index + 1} / {steps.length}
          </b>
          <span>{topic.q}</span>
        </div>
        {ready ? (
          <p className="guide-text">{glyphs(step.text)}</p>
        ) : (
          <p className="guide-text">
            <MousePointerClick size={14} className="guide-text-icon" />
            {glyphs(NEED_TEXT[step.needs!])}
          </p>
        )}
        {ready && step.hint && (
          <p className="guide-hint">
            <Lightbulb size={12} />
            <span>{glyphs(step.hint)}</span>
          </p>
        )}
        {missingBp && <p className="guide-hint">{tr("このサイトには小さい画面用のブレークポイントがありません。")}</p>}
        {!found && !missingBp && (
          <p className="guide-hint">
            {tr("示す場所が画面に見当たりません。パネルが閉じていないか、前の手順が済んでいるかを確かめてください。")}
          </p>
        )}
        {ready && checks && (
          <div className={`guide-status${done ? " is-done" : ""}`}>
            {done ? <CheckCircle2 size={14} /> : <Circle size={14} />}
            {done ? tr("できました") : tr("操作すると次へ進みます")}
          </div>
        )}
        <div className="guide-actions">
          <button type="button" className="guide-back-link" onClick={() => stopGuide(true)}>
            {tr("記事に戻る")}
          </button>
          {index > 0 && (
            <button type="button" className="btn btn-sm" onClick={() => setGuideStep(index - 1)}>
              <ChevronLeft size={13} />
              {tr("戻る")}
            </button>
          )}
          {last ? (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => stopGuide()}>
              {tr("完了")}
            </button>
          ) : (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setGuideStep(index + 1)}>
              {tr("次へ")}
              <ChevronRight size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
