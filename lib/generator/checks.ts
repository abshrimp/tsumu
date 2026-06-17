/**
 * 公開前のチェック（リンク切れ・代替テキスト・見出しの順序・スマホでの表示など）
 */

import type { DocNode, Page, SiteDoc } from "../types";
import { BP_ORDER, isHiddenAt, resolveStyles } from "../style";
import { tr } from "../i18n";
import { validateSlugUsage } from "../vars";
import { isDataStep, listFromOf, pageDataSteps } from "../data";
import { autoNamed, NEW_PAGE_NAME } from "../pageTitle";
import { walkSteps } from "../script";
import { SELF_TARGET } from "../types";
import { normalizeQuery } from "./page";

/* ---------- 公開前チェック ---------- */

export interface CheckResult {
  level: "warn" | "error";
  message: string;
  /** 理由と直し方を説明するヘルプの記事ID */
  help?: string;
}

/** 新しいサイトの初期のサイト名（lib/presets.ts の createInitialDoc） */
const DEFAULT_SITE_NAME = "My Site";

/** ページの追加（page-3）・複製（about-copy、about-copy-2）で自動で付けたURLか */
function autoSlug(slug: string): boolean {
  return slug
    .split("/")
    .some((seg) => /^page-\d+$/.test(seg) || /(^|-)copy(-\d+)?$/.test(seg));
}

export function runChecks(doc: SiteDoc): CheckResult[] {
  const results: CheckResult[] = [];
  const routes = new Map<string, { name: string; query: string; shareable: boolean }[]>();
  const published = doc.pageOrder.filter((pid) => !doc.pages[pid].unpublished);
  /** shareable = 通常のページ（クエリが違えば同じURLを共有できる） */
  const registerRoute = (page: Page, shareable = false) => {
    // [slug] を含むURLは固有ルートとして扱う（/events と /events/[slug] は共存可）
    const route = page.slug.replace(/^\/+|\/+$/g, "");
    const query = normalizeQuery(page.query);
    const same = routes.get(route) ?? [];
    const clash = same.find(
      (o) =>
        !shareable || !o.shareable || route === "404" || o.query === query
    );
    if (clash) {
      results.push({
        help: "page-url",
        level: "error",
        message:
          shareable && clash.shareable && route !== "404"
            ? tr("URL「/{route}{p2}」が「{name}」と「{name2}」で重複しています（クエリを変えてください）", { route, p2: query ? `?${query}` : "", name: clash.name, name2: page.name })
            : tr("URL「/{route}」が「{name}」と「{name2}」で重複しています", { route, name: clash.name, name2: page.name }),
      });
    }
    routes.set(route, [...same, { name: page.name, query, shareable }]);
    const slugErr = validateSlugUsage(route);
    if (slugErr) {
      results.push({
        help: "data-detail",
        level: "error",
        message: tr("「{name}」のURL: {slugErr}", { name: page.name, slugErr }),
      });
    }
  };

  if (!published.length) {
    results.push({
      help: "page-draft",
      level: "error",
      message: tr("公開できるページがありません（すべて非公開になっています）"),
    });
  } else if (
    !published.some(
      (pid) => doc.pages[pid].slug.replace(/^\/+|\/+$/g, "") === ""
    )
  ) {
    results.push({
      help: "page-draft",
      level: "error",
      message: tr("トップページ（URLが空のページ）が非公開になっています"),
    });
  }

  // 自動で付いたままの URL・タイトルは、検索結果やシェアで内容が伝わらない
  if (!doc.siteName?.trim() || doc.siteName.trim() === DEFAULT_SITE_NAME) {
    results.push({
      help: "pub-site",
      level: "warn",
      message: tr("サイト名が初期値の「{siteName}」のままです（すべてのページのタイトルの後ろに付きます）", { siteName: doc.siteName?.trim() || DEFAULT_SITE_NAME }),
    });
  }
  const byTitle = new Map<string, string[]>();
  for (const pid of published) {
    const page = doc.pages[pid];
    if (autoSlug(page.slug)) {
      results.push({
        help: "page-url",
        level: "warn",
        message: tr("「{name}」のURL「/{slug}」が自動で付けたままです（内容を表す短い英単語にすると、検索やシェアで伝わりやすくなります）", { name: page.name, slug: page.slug }),
      });
    }
    // 転送・HTMLページはタイトルを出さない
    if (page.redirectTo !== undefined || page.rewriteTo !== undefined || page.rawHtml?.trim()) continue;
    const title = (page.title || page.name).trim();
    if (autoNamed(title, NEW_PAGE_NAME)) {
      results.push({
        help: "page-seo",
        level: "warn",
        message: tr("「{name}」の検索・シェア用タイトルが自動で付けた「{title}」のままです", { name: page.name, title }),
      });
    }
    byTitle.set(title, [...(byTitle.get(title) ?? []), page.name]);
  }
  for (const [title, names] of byTitle) {
    if (names.length < 2) continue;
    results.push({
      help: "page-seo",
      level: "warn",
      message: tr("{names} の検索・シェア用タイトルが同じ「{title}」です（検索結果やタブで見分けられません）", {
        names: names.map((n) => tr("「{name}」", { name: n })).join(tr("・")),
        title,
      }),
    });
  }

  const ogUsesAsset =
    !!doc.ogImage?.assetId ||
    published.some((pid) => doc.pages[pid].ogImage?.assetId);
  if (ogUsesAsset && !doc.siteUrl?.trim()) {
    results.push({
      help: "pub-site",
      level: "warn",
      message:
        tr("シェア用画像を正しく出すため、サイト設定でサイトURLを設定してください"),
    });
  }

  const assetRefs: { id: string; label: string }[] = [];
  if (doc.favicon?.assetId) {
    assetRefs.push({ id: doc.favicon.assetId, label: tr("ファビコン") });
  }
  if (doc.appleTouchIcon?.assetId) {
    assetRefs.push({ id: doc.appleTouchIcon.assetId, label: tr("ホーム画面アイコン") });
  }
  if (doc.ogImage?.assetId) {
    assetRefs.push({ id: doc.ogImage.assetId, label: tr("デフォルトのOGP画像") });
  }
  for (const pageId of published) {
    const page = doc.pages[pageId];
    if (page.ogImage?.assetId) {
      assetRefs.push({ id: page.ogImage.assetId, label: tr("「{name}」のOGP画像", { name: page.name }) });
    }
  }
  for (const node of Object.values(doc.nodes)) {
    const assetId = node.image?.assetId ?? node.media?.assetId;
    if (assetId) assetRefs.push({ id: assetId, label: tr("「{name}」", { name: node.name }) });
  }
  for (const ref of assetRefs) {
    if (!doc.assets[ref.id]) {
      results.push({
        help: "img-add",
        level: "error",
        message: tr("{label}が存在しないアセットを参照しています", { label: ref.label }),
      });
    }
  }

  for (const pageId of published) {
    const page = doc.pages[pageId];
    if (page.redirectTo !== undefined || page.rewriteTo !== undefined) {
      registerRoute(page);
      if (!page.redirectTo?.trim() && !page.rewriteTo?.trim()) {
        results.push({
          help: "page-redirect",
          level: "error",
          message: tr("リダイレクトページ「{name}」に転送先または表示する外部サイトが設定されていません", { name: page.name }),
        });
      } else if (
        page.redirectTo?.trim() &&
        !/^\/(?!\/)/.test(page.redirectTo.trim()) &&
        !/^https?:\/\//i.test(page.redirectTo.trim())
      ) {
        results.push({
          help: "page-redirect",
          level: "error",
          message: tr("リダイレクトページ「{name}」の301転送先は / から始まるサイト内URLか http(s) URLにしてください", { name: page.name }),
        });
      } else if (
        page.rewriteTo?.trim() &&
        !/^https?:\/\/[^/?#]+/i.test(page.rewriteTo.trim())
      ) {
        results.push({
          help: "page-redirect",
          level: "error",
          message: tr("リダイレクトページ「{name}」の表示する外部サイトは http(s):// から始まるURLにしてください", { name: page.name }),
        });
      }
      continue;
    }
    if (page.rawHtml?.trim()) {
      registerRoute(page);
      continue;
    }
    registerRoute(page, true);

    let hasH1 = false;
    // スクリプト「ページを開いたとき」のデータのブロック
    const loadVars = new Set<string>();
    const dataSteps = pageDataSteps(doc, page.id);
    for (const st of dataSteps) {
      if (!isDataStep(st)) {
        if (st.kind === "array-find" && st.into && !st.field) {
          results.push({
            help: "data-detail",
            level: "error",
            message: tr("「{name}」のスクリプトで、配列の要素を探す項目が選ばれていません", { name: page.name }),
          });
        }
        if (st.kind === "array-field" && st.array && !st.field) {
          results.push({
            help: "data-list",
            level: "error",
            message: tr("「{name}」のスクリプトで、配列の要素に格納する項目名が空です", { name: page.name }),
          });
        }
        if ("into" in st && st.into) loadVars.add(st.into);
        continue;
      }
      if (!st.url.trim()) {
        results.push({
          help: "data-fetch",
          level: "error",
          message: tr("「{name}」のスクリプトで、データを取得するURLが空です", { name: page.name }),
        });
      }
    }
    const hasData = loadVars.size > 0;
    const idCount = new Map<string, number>();
    const scriptRefs: { name: string; targetId: string }[] = [];
    const seenNodes = new Set<string>();
    const walk = (id: string) => {
      if (seenNodes.has(id)) return;
      seenNodes.add(id);
      const node = doc.nodes[id];
      if (!node) return;
      if (node.type === "instance") {
        const comp = doc.components?.[node.componentId ?? ""];
        if (comp) walk(comp.rootId);
        return;
      }
      if (node.text?.heading === 1) hasH1 = true;
      if (node.attrId) {
        idCount.set(node.attrId, (idCount.get(node.attrId) ?? 0) + 1);
      }
      for (const sc of node.scripts ?? []) {
        if (!sc.trigger) continue;
        walkSteps(sc.steps, (st) => {
          const t =
            "target" in st
              ? st.target
              : st.kind === "if" && st.cond.subject !== "var"
                ? st.cond.target
                : null;
          if (t !== null && t !== SELF_TARGET) {
            scriptRefs.push({ name: node.name, targetId: t });
          }
          if (st.kind === "open-page" && !doc.pages[st.pageId]) {
            results.push({
              help: "act-link",
              level: "warn",
              message: tr("「{name}」の「{name2}」のスクリプトで開くページが選択されていないか、削除されています", { name: page.name, name2: node.name }),
            });
          }
        });
      }
      if (node.link?.kind === "page" && node.link.pageId) {
        const target = doc.pages[node.link.pageId];
        if (!target) {
          results.push({
            help: "act-link",
            level: "warn",
            message: tr("「{name}」の「{name2}」のリンク先ページが削除されています（トップページへのリンクになります）", { name: page.name, name2: node.name }),
          });
        } else if (target.unpublished) {
          results.push({
            help: "page-draft",
            level: "warn",
            message: tr("「{name}」の「{name2}」のリンク先「{name3}」が非公開です（404になります）", { name: page.name, name2: node.name, name3: target.name }),
          });
        }
      }
      if (node.type === "list" && !listFromOf(node)) {
        results.push({
          help: "data-list",
          level: "warn",
          message: tr("「{name}」のリスト「{name2}」に並べる配列が選ばれていません（出力されません）", { name: page.name, name2: node.name }),
        });
      }
      if (node.type === "image" && node.image && !node.image.alt) {
        results.push({
          help: "img-alt",
          level: "warn",
          message: tr("「{name}」の画像「{name2}」に代替テキスト（alt）が設定されていません", { name: page.name, name2: node.name }),
        });
      }
      if (
        node.type === "field" &&
        node.field &&
        node.field.kind !== "submit" &&
        !node.attrId
      ) {
        results.push({
          help: "act-vars",
          level: "warn",
          message: tr("「{name}」のフォーム部品「{name2}」にID属性がありません（値が送信されず {変数} としても使えません）", { name: page.name, name2: node.name }),
        });
      }
      node.children.forEach(walk);
    };
    page.children.forEach(walk);
    results.push(...designChecks(doc, page));
    for (const t of scriptRefs) {
      if (!t.targetId) {
        results.push({
          help: "act-script",
          level: "warn",
          message: tr("「{name}」の「{name2}」のスクリプトに対象が選択されていないブロックがあります", { name: page.name, name2: t.name }),
        });
      } else if (!idCount.has(t.targetId)) {
        results.push({
          help: "act-script",
          level: "warn",
          message: tr("「{name}」の「{name2}」のスクリプトの対象ID「{targetId}」がこのページに見つかりません", { name: page.name, name2: t.name, targetId: t.targetId }),
        });
      }
    }
    for (const [aid, n] of idCount) {
      if (n > 1) {
        results.push({
          help: "act-anchor",
          level: "warn",
          message: tr("「{name}」でID「{aid}」が{n}個の要素に重複しています（{変数}やアンカーが正しく動きません）", { name: page.name, aid, n }),
        });
      }
    }
    if (page.slug.includes("[slug]") && idCount.has("slug")) {
      results.push({
        help: "data-detail",
        level: "warn",
        message: tr("[slug]ページ「{name}」のID「slug」はページ変数 {slug} と重複しています（別のIDにしてください）", { name: page.name }),
      });
    }
    if (page.slug.includes("[slug]") && !hasData) {
      results.push({
        help: "data-detail",
        level: "warn",
        message: tr("[slug]ページ「{name}」でデータを取得していません（ページを開いたときのスクリプトで、{slug} を使って1件のデータを取得してください）", { name: page.name }),
      });
    }
    if (!hasH1) {
      results.push({
        help: "text-heading",
        level: "warn",
        message: tr("「{name}」に見出し1（h1）がありません", { name: page.name }),
      });
    }
  }
  results.push(...componentCycleChecks(doc, published));
  return results;
}

/** スマホの画面幅の目安（はみ出しの判定に使う） */
const PHONE_WIDTH = 375;

/** リンクの文字として、行き先が伝わらない言葉 */
const VAGUE_LINK_TEXT = /^(こちら|ここ|こちらから|こちらをクリック|ここをクリック|クリック|click here|here|more)$/i;

/** "16px" / "1.5rem" → px（それ以外の単位は判定しない） */
function toPx(v: string | undefined): number | null {
  const m = /^(-?\d*\.?\d+)(px|rem)$/.exec(v?.trim() ?? "");
  if (!m) return null;
  return m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
}

/** 押すとページ・URLを開く要素か */
function opensLink(node: DocNode): boolean {
  if (node.link) return true;
  return !!node.scripts?.some(
    (sc) =>
      sc.trigger === "click" &&
      sc.steps.some((st) => st.kind === "open-page" || st.kind === "open-url")
  );
}

/** 「〇〇」ほかN件 */
function namesText(names: string[]): string {
  const first = tr("「{name}」", { name: names[0] });
  return names.length > 1 ? tr("{first}ほか{n}件", { first, n: names.length - 1 }) : first;
}

/**
 * Webデザインの慣例に照らした注意（公開はできる）。
 * スマホで読めない小さな文字・画面からはみ出す固定幅・見出しの段の飛ばし・行き先の分からないリンク
 */
function designChecks(doc: SiteDoc, page: Page): CheckResult[] {
  const out: CheckResult[] = [];
  const small = BP_ORDER.length > 1 ? BP_ORDER[BP_ORDER.length - 1] : null;
  const headings: number[] = [];
  const tiny: string[] = [];
  const wide: { id: string; name: string; width: number }[] = [];
  const vague: { name: string; text: string }[] = [];

  /** inWide = 親がすでにはみ出している（中の要素は親が直れば収まるので、幅では数えない） */
  const walk = (id: string, hiddenSmall: boolean, hiddenBase: boolean, inWide: boolean) => {
    const n = doc.nodes[id];
    if (!n) return;
    let wideHere = false;
    const hidBase = hiddenBase || isHiddenAt(n, "base");
    const hidSmall = hiddenSmall || (small ? isHiddenAt(n, small) : hidBase);
    const text = n.text?.content.trim() ?? "";
    if (n.text && n.text.heading > 0 && !hidBase) headings.push(n.text.heading);
    if (small && !hidSmall) {
      const st = resolveStyles(n, small, "default");
      const size = toPx(st.fontSize);
      if (text && size !== null && size < 12) tiny.push(n.name);
      // 画像は公開サイトでも親の幅を超えないので除く
      if (!inWide && n.type !== "image" && st.position !== "fixed") {
        const max = st.maxWidth?.trim();
        const capped = !!max && (/%$/.test(max) || (toPx(max) ?? Infinity) <= PHONE_WIDTH);
        const width = Math.max(toPx(st.minWidth) ?? 0, capped ? 0 : (toPx(st.width) ?? 0));
        if (width > PHONE_WIDTH) {
          wide.push({ id: n.id, name: n.name, width: Math.round(width) });
          wideHere = true;
        }
      }
    }
    if (text && opensLink(n) && VAGUE_LINK_TEXT.test(text)) vague.push({ name: n.name, text });
    n.children.forEach((c) => walk(c, hidSmall, hidBase, inWide || wideHere));
  };
  page.children.forEach((id) => walk(id, false, false, false));

  if (tiny.length) {
    out.push({
      help: "d-type-scale",
      level: "warn",
      message: tr("「{name}」のスマホ表示で、12px未満の読みにくい文字があります（{p2}）", { name: page.name, p2: namesText(tiny) }),
    });
  }
  if (wide.length) {
    out.push({
      help: "d-units",
      level: "warn",
      message: tr("「{name}」の{p2}は幅が{width}pxで固定されていて、スマホ（幅{PHONE_WIDTH}px前後）の画面からはみ出します（幅を%にするか、最大幅を付けてください）", { name: page.name, p2: namesText(wide.map((w) => w.name)), width: wide[0].width, PHONE_WIDTH }),
    });
  }
  const h1 = headings.filter((h) => h === 1).length;
  if (h1 > 1) {
    out.push({
      help: "text-heading",
      level: "warn",
      message: tr("「{name}」に見出し1が{h1}つあります（ページの題名だけを見出し1にします）", { name: page.name, h1 }),
    });
  }
  for (let i = 1; i < headings.length; i++) {
    if (headings[i] > headings[i - 1] + 1) {
      out.push({
        help: "text-heading",
        level: "warn",
        message: tr("「{name}」で見出し{p2}の次が見出し{p3}になっています（見出しの段は1つずつ下げます）", { name: page.name, p2: headings[i - 1], p3: headings[i] }),
      });
      break;
    }
  }
  if (vague.length) {
    out.push({
      help: "act-link",
      level: "warn",
      message:
        vague.length > 1
          ? tr("「{name}」のリンクの文字が「{text}」です（ほか{n}件）。行き先が分かる言葉にしてください", { name: page.name, text: vague[0].text, n: vague.length - 1 })
          : tr("「{name}」のリンクの文字が「{text}」です。行き先が分かる言葉にしてください", { name: page.name, text: vague[0].text }),
    });
  }
  return out;
}

/** 使っているコンポーネント（インスタンスの中のインスタンスもたどる） */
function componentsUsedUnder(doc: SiteDoc, rootIds: string[]): Set<string> {
  const used = new Set<string>();
  const seen = new Set<string>();
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = doc.nodes[id];
    if (!n) continue;
    const comp = n.type === "instance" ? doc.components?.[n.componentId ?? ""] : undefined;
    if (comp && !used.has(comp.id)) {
      used.add(comp.id);
      stack.push(comp.rootId);
    }
    stack.push(...n.children);
  }
  return used;
}

/**
 * 自分自身を（入れ子のインスタンスを通じて）含むコンポーネント。
 * 公開サイトでは表示が無限に続いてページが出せないため、使っていれば公開を止める
 */
function componentCycleChecks(doc: SiteDoc, published: string[]): CheckResult[] {
  const comps = Object.values(doc.components ?? {});
  const cyclic = comps.filter((c) => componentsUsedUnder(doc, [c.rootId]).has(c.id));
  if (!cyclic.length) return [];
  const loadingPageId = doc.loadingScreen?.enabled ? doc.loadingScreen.pageId : undefined;
  const used = componentsUsedUnder(
    doc,
    [...published, ...(loadingPageId ? [loadingPageId] : [])].flatMap(
      (pid) => doc.pages[pid]?.children ?? []
    )
  );
  return cyclic.map((c) => ({
    help: "reuse-component",
    level: used.has(c.id) ? ("error" as const) : ("warn" as const),
    message: tr("コンポーネント「{name}」が自分自身を含んでいます（無限に入れ子になります）。マスターから自分自身のインスタンスを取り除いてください", { name: c.name }),
  }));
}
