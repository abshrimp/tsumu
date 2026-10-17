"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Component,
  Compass,
  Database,
  FileText,
  Globe,
  Image,
  Keyboard,
  LayoutGrid,
  Lightbulb,
  MousePointerClick,
  Palette,
  Play,
  Route,
  Search,
  Smartphone,
  SquarePlus,
  TriangleAlert,
  Type,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEditor } from "../lib/store";
import {
  CATEGORIES,
  LEVELS,
  TOPIC_BY_ID,
  currentContexts,
  searchTopics,
  topicsFor,
  type Block,
  type CategoryId,
  type Level,
  type Topic,
} from "../lib/manual";
import { TOPICS } from "../lib/manualTopics";
import { closeHelp, goBack, showTopic, startGuide, useHelp } from "../lib/help";
import { glyphs } from "./Glyph";
import HelpFigure from "./HelpFigures";
import { tr, trNodes } from "../lib/i18n";

const CAT_ICON: Record<CategoryId, LucideIcon> = {
  start: Compass,
  page: FileText,
  element: SquarePlus,
  text: Type,
  layout: LayoutGrid,
  look: Palette,
  image: Image,
  responsive: Smartphone,
  action: MousePointerClick,
  data: Database,
  reuse: Component,
  publish: Globe,
  design: Lightbulb,
};

/** 選んでいるものの呼び名（「いまの作業に関係する質問」の見出しに使う） */
const CONTEXT_LABEL: Record<string, string> = {
  none: tr("ページ全体"),
  text: tr("選んでいる文字"),
  image: tr("選んでいる画像"),
  box: tr("選んでいるボックス"),
  list: tr("選んでいるリスト"),
  instance: tr("選んでいるコンポーネント"),
  field: tr("選んでいるフォーム部品"),
  media: tr("選んでいる動画・埋め込み"),
  body: "body",
  mobile: tr("スマホなどの表示"),
  component: tr("コンポーネントの編集"),
  site: tr("サイト設定"),
};

/** ヘルプを閉じても、選んだ難易度・カテゴリは覚えておく */
let rememberedLevel: Level | 0 = 0;
let rememberedCat: CategoryId | null = null;

/* ---------- 本文の文字（**強調**・`コード`・[[記事ID|リンク]]） ---------- */

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\])/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) return <b key={i}>{glyphs(part.slice(2, -2))}</b>;
        if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
        const link = /^\[\[([^|\]]+)\|([^\]]+)\]\]$/.exec(part);
        if (link) {
          const target = TOPIC_BY_ID[link[1]];
          return target ? (
            <button key={i} type="button" className="help-inline-link" onClick={() => showTopic(target.id)}>
              {glyphs(link[2])}
            </button>
          ) : (
            <Fragment key={i}>{link[2]}</Fragment>
          );
        }
        return <Fragment key={i}>{glyphs(part)}</Fragment>;
      })}
    </>
  );
}

function LevelBadge({ level }: { level: Level }) {
  return <span className={`help-level is-l${level}`}>{LEVELS[level].label}</span>;
}

/** 検索語に一致した部分に印をつける */
function Highlight({ text, query }: { text: string; query?: string }) {
  const words = (query ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${words.join("|")})`, "gi"));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>))}</>;
}

function TopicRow({
  topic,
  showCat,
  hideLevel,
  query,
}: {
  topic: Topic;
  showCat?: boolean;
  /** 難易度ごとに分けて並べているときは、行ごとのバッジを出さない */
  hideLevel?: boolean;
  query?: string;
}) {
  const cat = CATEGORIES.find((c) => c.id === topic.cat);
  return (
    <button type="button" className="help-row" onClick={() => showTopic(topic.id)}>
      <span className="help-row-q">
        <Highlight text={topic.q} query={query} />
        {showCat && cat && <span className="help-row-cat">{cat.label}</span>}
      </span>
      <span className="help-row-meta">
        {topic.guide && (
          <span className="help-row-guide" data-tip={tr("画面で場所を示しながら案内します")}>
            <Route size={12} />
          </span>
        )}
        {!hideLevel && <LevelBadge level={topic.level} />}
        <ChevronRight size={14} className="help-row-chev" />
      </span>
    </button>
  );
}

/* ---------- 本文 ---------- */

function BlockView({ block, onStartTutorial }: { block: Block; onStartTutorial: () => void }) {
  if ("p" in block) {
    return (
      <p className="help-p">
        <Inline text={block.p} />
      </p>
    );
  }
  if ("list" in block) {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag className={`help-list${block.ordered ? " is-ordered" : ""}`}>
        {block.list.map((item, i) => (
          <li key={i}>
            <Inline text={item} />
          </li>
        ))}
      </Tag>
    );
  }
  if ("rule" in block) {
    return (
      <div className="help-rule">
        <div className="help-rule-head">
          <Lightbulb size={13} />
          {block.title ?? tr("Webデザインのコツ")}
        </div>
        <p>
          <Inline text={block.rule} />
        </p>
      </div>
    );
  }
  if ("note" in block) {
    return (
      <p className="help-note">
        <Inline text={block.note} />
      </p>
    );
  }
  if ("warn" in block) {
    return (
      <div className="help-warn">
        <TriangleAlert size={13} />
        <p>
          <Inline text={block.warn} />
        </p>
      </div>
    );
  }
  if ("table" in block) {
    return (
      <div className="help-table-wrap">
        <table className="help-table">
          <thead>
            <tr>
              {block.table.head.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.table.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>
                    <Inline text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if ("code" in block) return <pre className="help-code">{block.code}</pre>;
  if ("fig" in block) return <HelpFigure id={block.fig} caption={block.caption} />;
  if ("action" in block && block.action === "tutorial") {
    return (
      <button type="button" className="btn btn-primary help-cta" onClick={onStartTutorial}>
        <Play size={13} />
        {tr("チュートリアルを始める（約10分）")}
      </button>
    );
  }
  return null;
}

function Article({ topic, onStartTutorial }: { topic: Topic; onStartTutorial: () => void }) {
  const related = (topic.see ?? []).map((id) => TOPIC_BY_ID[id]).filter(Boolean);
  // 本文の最初の図は、答えのすぐ下（案内ボタンの前）に出す
  const lead = topic.body[0] && "fig" in topic.body[0] ? topic.body[0] : null;
  const rest = lead ? topic.body.slice(1) : topic.body;
  return (
    <article className="help-article">
      <div className="help-article-meta">
        <LevelBadge level={topic.level} />
        {topic.guide && (
          <span className="help-article-guide">
            <Route size={12} />
            {tr("画面で案内できます")}
          </span>
        )}
      </div>
      <h2 className="help-q">{topic.q}</h2>
      <p className="help-a">
        <Inline text={topic.a} />
      </p>
      {lead && <BlockView block={lead} onStartTutorial={onStartTutorial} />}
      {topic.guide && (
        <button type="button" className="btn btn-primary help-cta" onClick={() => startGuide(topic.id)}>
          <Route size={13} />
          {tr("画面で場所を示しながら案内する")}
        </button>
      )}
      <div className="help-blocks">
        {rest.map((b, i) => (
          <BlockView key={i} block={b} onStartTutorial={onStartTutorial} />
        ))}
      </div>
      {topic.guide && (
        <details className="help-sec help-steps-sec" key={topic.id}>
          <summary>
            <ChevronRight size={13} />
            {tr("操作の手順")}
            <span className="help-sec-sub">{tr("{n}ステップ", { n: topic.guide.length })}</span>
          </summary>
          <ol className="help-steps">
            {topic.guide.map((st, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="help-step"
                  onClick={() => startGuide(topic.id, i)}
                  data-tip={tr("この手順から画面で案内する")}
                >
                  <span className="help-step-no">{i + 1}</span>
                  <span>{glyphs(st.text)}</span>
                </button>
              </li>
            ))}
          </ol>
        </details>
      )}
      {related.length > 0 && (
        <section className="help-sec">
          <h3>{tr("関連する質問")}</h3>
          <div className="help-rows">
            {related.map((t) => (
              <TopicRow key={t.id} topic={t} />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}

/* ---------- 一覧 ---------- */

function LevelFilter({ value, onChange }: { value: Level | 0; onChange: (v: Level | 0) => void }) {
  return (
    <div className="help-levels" role="radiogroup" aria-label={tr("難易度")}>
      {([0, 1, 2, 3, 4] as const).map((lv) => (
        <button
          key={lv}
          type="button"
          role="radio"
          aria-checked={value === lv}
          className={value === lv ? "is-on" : ""}
          data-tip={lv ? LEVELS[lv].desc : undefined}
          onClick={() => onChange(lv)}
        >
          {lv ? LEVELS[lv].label : tr("すべて")}
        </button>
      ))}
    </div>
  );
}

function Home({
  level,
  onOpenCat,
  onStartTutorial,
}: {
  level: Level | 0;
  onOpenCat: (id: CategoryId) => void;
  onStartTutorial: () => void;
}) {
  // いま選んでいる要素・表示している画面に関係する質問
  const contexts = useEditor((s) => currentContexts(s).join(","));
  const suggestions = useMemo(
    () => topicsFor(contexts.split(",") as Parameters<typeof topicsFor>[0], 5),
    [contexts]
  );
  const ctxLabel = CONTEXT_LABEL[contexts.split(",")[0]] ?? "";
  const counts = (cat: CategoryId) =>
    TOPICS.filter((t) => t.cat === cat && (!level || t.level === level)).length;

  return (
    <>
      {(level === 0 || level === 1) && (
        <div className="help-hero">
          <div className="help-hero-icon">
            <Play size={16} />
          </div>
          <div className="help-hero-text">
            <strong>{tr("はじめての方は、チュートリアルから")}</strong>
            <p>{tr("練習ページを作りながら、基本の操作と考え方を約10分で学べます。")}</p>
          </div>
          <button type="button" className="btn btn-sm btn-primary" onClick={onStartTutorial}>
            {tr("始める")}
          </button>
        </div>
      )}

      {suggestions.length > 0 && level === 0 && (
        <section className="help-sec">
          <h3>{tr("{ctx}についてよくある質問", { ctx: ctxLabel })}</h3>
          <div className="help-rows">
            {suggestions.map((t) => (
              <TopicRow key={t.id} topic={t} />
            ))}
          </div>
        </section>
      )}

      <section className="help-sec">
        <h3>{tr("カテゴリから探す")}</h3>
        <div className="help-cats">
          {CATEGORIES.map((c) => {
            const Icon = CAT_ICON[c.id];
            const n = counts(c.id);
            if (!n) return null;
            return (
              <button
                key={c.id}
                type="button"
                className={`help-cat${c.id === "design" ? " is-design" : ""}`}
                onClick={() => onOpenCat(c.id)}
              >
                <span className="help-cat-icon">
                  <Icon size={16} />
                </span>
                <span className="help-cat-text">
                  <span className="help-cat-label">{c.label}</span>
                  <span className="help-cat-desc">{c.desc}</span>
                </span>
                <span className="help-cat-count">{n}</span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

function CategoryView({ id, level }: { id: CategoryId; level: Level | 0 }) {
  const cat = CATEGORIES.find((c) => c.id === id)!;
  const Icon = CAT_ICON[id];
  const topics = TOPICS.filter((t) => t.cat === id && (!level || t.level === level));
  const groups = ([1, 2, 3, 4] as Level[])
    .map((lv) => ({ lv, items: topics.filter((t) => t.level === lv) }))
    .filter((g) => g.items.length);
  return (
    <div>
      <div className="help-cat-head">
        <span className="help-cat-icon">
          <Icon size={18} />
        </span>
        <div>
          <h2>{cat.label}</h2>
          <p>{cat.desc}</p>
        </div>
      </div>
      {groups.map((g) => (
        <section key={g.lv} className="help-sec">
          <h3>
            {LEVELS[g.lv].label}
            <span className="help-sec-sub">{LEVELS[g.lv].desc}</span>
          </h3>
          <div className="help-rows">
            {g.items.map((t) => (
              <TopicRow key={t.id} topic={t} hideLevel />
            ))}
          </div>
        </section>
      ))}
      {!groups.length && <p className="help-empty">{tr("この難易度の質問はありません。")}</p>}
    </div>
  );
}

/* ---------- 本体 ---------- */

export default function HelpCenter({ onStartTutorial }: { onStartTutorial: () => void }) {
  const open = useHelp((s) => s.open);
  const topicId = useHelp((s) => s.topicId);
  const canGoBack = useHelp((s) => s.back.length > 0);
  const [query, setQuery] = useState("");
  const [level, setLevelState] = useState<Level | 0>(rememberedLevel);
  const [cat, setCatState] = useState<CategoryId | null>(rememberedCat);
  const bodyRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const setLevel = (v: Level | 0) => {
    rememberedLevel = v;
    setLevelState(v);
  };
  const setCat = (v: CategoryId | null) => {
    rememberedCat = v;
    setCatState(v);
  };

  const topic = topicId ? TOPIC_BY_ID[topicId] : null;
  const results = useMemo(() => {
    const found = searchTopics(query);
    return level ? found.filter((t) => t.level === level) : found;
  }, [query, level]);

  // 記事・カテゴリを切り替えたら、先頭から読めるようにする
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [topicId, cat, open]);

  useEffect(() => {
    if (open && !topicId) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open, topicId]);

  if (!open) return null;

  const startTutorial = () => {
    closeHelp();
    onStartTutorial();
  };

  const back = () => {
    if (topic) goBack();
    else if (query) setQuery("");
    else setCat(null);
  };
  const showBack = !!topic || !!query || !!cat;

  // ヘッダーのパンくず: ヘルプ › カテゴリ（記事・カテゴリを開いているとき）
  const crumbCat = topic ? topic.cat : !query.trim() ? cat : null;
  const crumbLabel = crumbCat ? CATEGORIES.find((c) => c.id === crumbCat)?.label : null;
  const atHome = !topic && !query.trim() && !cat;
  const openList = (id: CategoryId | null) => {
    setQuery("");
    setCat(id);
    useHelp.setState({ topicId: null, back: [] });
  };
  // 表示を切り替えたときだけ、本文をふわっと出し直す
  const viewKey = topic ? `t:${topic.id}` : query.trim() ? "search" : cat ? `c:${cat}` : "home";

  return (
    <aside
      className="help"
      role="dialog"
      aria-label={tr("ヘルプ")}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        // 入力中の検索語があれば先に消す。エディタの Esc（選択を外す）までは届かせない
        e.stopPropagation();
        if (query && (e.target as HTMLElement).tagName === "INPUT") setQuery("");
        else closeHelp();
      }}
    >
      <div className="help-head">
        {showBack ? (
          <button
            type="button"
            className="icon-btn"
            aria-label={tr("戻る")}
            data-tip={topic && canGoBack ? tr("前の記事へ") : tr("一覧へ")}
            onClick={back}
          >
            <ChevronLeft size={16} />
          </button>
        ) : (
          <span className="help-head-icon">
            <CircleHelp size={16} />
          </span>
        )}
        <nav className="help-crumbs" aria-label={tr("現在地")}>
          <button type="button" className="help-crumb-btn" disabled={atHome} onClick={() => openList(null)}>
            {tr("ヘルプ")}
          </button>
          {crumbCat && crumbLabel && (
            <>
              <ChevronRight size={13} className="help-crumb-sep" />
              <button
                type="button"
                className="help-crumb-btn"
                disabled={!topic}
                onClick={() => openList(crumbCat)}
              >
                {crumbLabel}
              </button>
            </>
          )}
        </nav>
        <button type="button" className="icon-btn" aria-label={tr("ヘルプを閉じる")} data-tip={tr("閉じる（Esc）")} onClick={closeHelp}>
          <X size={16} />
        </button>
      </div>

      {!topic && (
        <div className="help-tools">
          <label className="help-search">
            <Search size={14} />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder={tr("やりたいことで探す（例: 横に並べる・スマホ）")}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" aria-label={tr("検索をクリア")} onClick={() => setQuery("")}>
                <X size={12} />
              </button>
            )}
          </label>
          <LevelFilter value={level} onChange={setLevel} />
        </div>
      )}

      <div className="help-body" ref={bodyRef}>
        <div className="help-view" key={viewKey}>
          {topic ? (
            <Article key={topic.id} topic={topic} onStartTutorial={startTutorial} />
          ) : query.trim() ? (
            results.length ? (
              <section className="help-sec">
                <h3>{tr("「{q}」の検索結果（{n}件）", { q: query.trim(), n: results.length })}</h3>
                <div className="help-rows">
                  {results.map((t) => (
                    <TopicRow key={t.id} topic={t} showCat query={query} />
                  ))}
                </div>
              </section>
            ) : (
              <div className="help-empty">
                <span className="help-empty-icon">
                  <Search size={18} />
                </span>
                <p className="help-empty-title">{tr("「{q}」に当てはまる質問が見つかりませんでした。", { q: query.trim() })}</p>
                <p>{tr("短い言葉（「画像」「色」「スマホ」など）や、別の言い方で探してみてください。")}</p>
                {level !== 0 && (
                  <button type="button" className="btn btn-sm" onClick={() => setLevel(0)}>
                    {tr("すべての難易度で探す")}
                  </button>
                )}
              </div>
            )
          ) : cat ? (
            <CategoryView id={cat} level={level} />
          ) : (
            <Home level={level} onOpenCat={setCat} onStartTutorial={startTutorial} />
          )}
        </div>
      </div>

      <div className="help-foot">
        <button type="button" onClick={() => showTopic("start-shortcuts")}>
          <Keyboard size={13} />
          {tr("ショートカット")}
        </button>
        <button type="button" onClick={startTutorial}>
          <Play size={13} />
          {tr("チュートリアル")}
        </button>
        <span className="help-foot-hint">{trNodes("{key} で開閉", { key: <kbd key="k">?</kbd> })}</span>
      </div>
    </aside>
  );
}

/** ヘルプへの小さな入口（セクション見出しや公開前チェックの「解説」に使う） */
export function HelpLink({
  topicId,
  label,
  onBefore,
  children,
}: {
  topicId: string;
  label?: string;
  /** 開く前にすること（モーダルを閉じる など） */
  onBefore?: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className="help-link"
      onClick={(e) => {
        e.stopPropagation();
        onBefore?.();
        useHelp.setState({ open: true, topicId, back: [], guide: null });
      }}
    >
      {children ?? label ?? tr("解説")}
    </button>
  );
}
