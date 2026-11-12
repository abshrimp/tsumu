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
import { normalizeQuery, routeDir } from "./page";
import { pageQueryConditions } from "../page-query";
import { missingHtmlZipScriptAssets } from "../html-zip-script-assets";

/* ---------- 公開前チェック ---------- */

export interface CheckResult {
  level: "warn" | "error";
  message: string;
  /** 理由と直し方を説明するヘルプの記事 ID */
  help?: string;
}

/** 新しいサイトの初期のサイト名（lib/presets.ts の createInitialDoc） */
const DEFAULT_SITE_NAME = "My Site";

/** ページの追加（page-3）や複製（about-copy、about-copy-2）で自動で付けた URL か */
function autoSlug(slug: string): boolean {
  return slug
    .split("/")
    .some((seg) => /^page-\d+$/.test(seg) || /(^|-)copy(-\d+)?$/.test(seg));
}

/** エディタで使える通常の URL と [slug]。知らない形式は判定しない。 */
function redirectSourceParts(slug: string): string[] | null {
  // generator の configSource と同じく、転送元の外側の / だけを取り除く。
  const source = slug.replace(/^\/+|\/+$/g, "");
  const parts = source ? source.split("/") : [];
  if (
    parts.some((part) => part !== "[slug]" && !/^[a-zA-Z0-9_-]+$/.test(part)) ||
    parts.filter((part) => part === "[slug]").length > 1
  ) return null;
  return parts;
}

/** 先に並ぶ転送に遮られず、転送先が同じ転送のルールに戻ってくる場合だけを検出する。 */
function hasSelfRedirect(page: Page, earlierRedirects: Page[]): boolean {
  const destination = page.redirectTo?.trim();
  if (!destination || !/^\/(?!\/)/.test(destination)) return false;
  const sourceParts = redirectSourceParts(page.slug);
  if (!sourceParts) return false;
  // Next.js の転送の判定は pathname だけを見る。転送先の連続した / は、応答のときにまとめられる。
  // /_next で始まるパスは、Next.js がカスタムの転送の対象から除外する。
  const path = destination.split(/[?#]/, 1)[0].replace(/\/{2,}/g, "/");
  if (/^\/_next/i.test(path)) return false;
  const target = path.slice(1).replace(/\/$/, "");
  const targetParts = target ? target.split("/") : [];
  const matchesSelf = sourceParts.length === targetParts.length && sourceParts.every((part, i) => {
    const to = targetParts[i];
    // 固定の転送先か、同じ位置の :slug なら、何度転送しても一致し続ける。
    // 変数の移動・複雑な式・外部の URL・複数のルールにまたがる循環は、ここでは判定しない。
    return part === "[slug]"
      ? to === ":slug" || /^[a-zA-Z0-9_-]+$/.test(to)
      : /^[a-zA-Z0-9_-]+$/.test(to) && part.toLowerCase() === to.toLowerCase();
  });
  if (!matchesSelf) return false;
  // Next.js は最初に一致したルールを使う。先に並ぶルールが転送先を受け取る可能性があれば、
  // このルールだけでループすると断定しない（転送先の :slug は安全側に倒して扱う）。
  return !earlierRedirects.some((earlier) => {
    const parts = redirectSourceParts(earlier.slug);
    if (!parts) return true;
    if (parts[0]?.toLowerCase().startsWith("_next")) return false;
    return parts.length === targetParts.length && parts.every((part, i) =>
      part === "[slug]" || targetParts[i] === ":slug" || part.toLowerCase() === targetParts[i].toLowerCase()
    );
  });
}

export function runChecks(doc: SiteDoc, { requireHomePage = true } = {}): CheckResult[] {
  const results: CheckResult[] = [];
  const routes = new Map<string, { name: string; conditions: string; shareable: boolean }[]>();
  const published = doc.pageOrder.filter((pid) => !doc.pages[pid].unpublished);
  /** shareable = 通常のページ（クエリが違えば、同じ URL を共有できる） */
  const registerRoute = (page: Page, shareable = false) => {
    // [slug] を含む URL は固有のルートとして扱う（/events と /events/[slug] は共存できる）
    const route = page.slug.replace(/^\/+|\/+$/g, "");
    const query = normalizeQuery(page.query);
    const conditions = normalizeQuery(new URLSearchParams(pageQueryConditions(page.query)).toString());
    // 生成処理は空の区切りをまとめ、ファイルシステムで特別な意味を持つ名前をエスケープする。
    // 2つのエディタの URL が同じファイルを上書きしないよう、実際に出力するルートで比べる。
    // 通常の特別な 404 のページは /404 のルートではなく、not-found.tsx に書き出す。
    const key = shareable && route === "404" ? "\0not-found" : routeDir(route);
    const same = routes.get(key) ?? [];
    const clash = same.find(
      (o) =>
        !shareable || !o.shareable || route === "404" || o.conditions === conditions
    );
    if (clash) {
      results.push({
        help: "page-url",
        level: "error",
        message:
          shareable && clash.shareable && route !== "404"
            ? tr("The URL \"/{route}{p2}\" is used by both \"{name}\" and \"{name2}\" (change the query)", { route, p2: query ? `?${query}` : "", name: clash.name, name2: page.name })
            : tr("The URL \"/{route}\" is used by both \"{name}\" and \"{name2}\"", { route, name: clash.name, name2: page.name }),
      });
    }
    routes.set(key, [...same, { name: page.name, conditions, shareable }]);
    const slugErr = validateSlugUsage(route);
    if (slugErr) {
      results.push({
        help: "data-detail",
        level: "error",
        message: tr("URL of \"{name}\": {slugErr}", { name: page.name, slugErr }),
      });
    }
  };

  if (!published.length) {
    results.push({
      help: "page-draft",
      level: "error",
      message: tr("No pages to publish (all pages are unpublished)"),
    });
  } else if (
    requireHomePage && !published.some(
      (pid) => doc.pages[pid].slug.replace(/^\/+|\/+$/g, "") === ""
    )
  ) {
    results.push({
      help: "page-draft",
      level: "error",
      message: tr("The home page (the page with an empty URL) is unpublished"),
    });
  }

  // こうしないと、HTML モードの空のソースから、黙って空白の Next.js のページが生成されてしまう。
  for (const pid of published) {
    const page = doc.pages[pid];
    if (page.rawHtml !== undefined && page.rawHtml !== null && !page.rawHtml.trim()) {
      results.push({
        level: "error",
        message: tr('HTML page "{name}" is empty. Load its HTML source before publishing.', { name: page.name }),
      });
    }
  }

  // 自動で付いたままの URL やタイトルでは、検索結果やシェアで内容が伝わらない
  if (!doc.siteName?.trim() || doc.siteName.trim() === DEFAULT_SITE_NAME) {
    results.push({
      help: "pub-site",
      level: "warn",
      message: tr("The site name is still the default \"{siteName}\" (it's added after every page title)", { siteName: doc.siteName?.trim() || DEFAULT_SITE_NAME }),
    });
  }
  const byTitle = new Map<string, string[]>();
  for (const pid of published) {
    const page = doc.pages[pid];
    if (autoSlug(page.slug)) {
      results.push({
        help: "page-url",
        level: "warn",
        message: tr("The URL \"/{slug}\" of \"{name}\" is still the automatic one (a short word that describes the page reads better in search results and shares)", { name: page.name, slug: page.slug }),
      });
    }
    // 転送と HTMLページでは、タイトルを出さない
    if (page.redirectTo !== undefined || page.rewriteTo !== undefined || page.rawHtml?.trim()) continue;
    const title = (page.title || page.name).trim();
    if (autoNamed(title, NEW_PAGE_NAME)) {
      results.push({
        help: "page-seo",
        level: "warn",
        message: tr("The search and share title of \"{name}\" is still the automatic \"{title}\"", { name: page.name, title }),
      });
    }
    byTitle.set(title, [...(byTitle.get(title) ?? []), page.name]);
  }
  for (const [title, names] of byTitle) {
    if (names.length < 2) continue;
    results.push({
      help: "page-seo",
      level: "warn",
      message: tr("{names} have the same search and share title \"{title}\" (they can't be told apart in search results or tabs)", {
        names: names.map((n) => tr("\"{name}\"", { name: n })).join(tr(", ")),
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
        tr("Set the site URL in Site settings so share images work correctly"),
    });
  }

  for (const pageId of published) {
    const page = doc.pages[pageId];
    if (!page.htmlZip || !page.rawHtml) continue;
    const missing = missingHtmlZipScriptAssets(page.rawHtml, page.htmlZip, doc.assets);
    if (missing.length) {
      results.push({
        level: "warn",
        message: tr('HTML page "{name}" refers to media files missing from its imported ZIP: {paths}', {
          name: page.name, paths: missing.slice(0, 6).join(", ") + (missing.length > 6 ? ", …" : ""),
        }),
      });
    }
  }

  const assetRefs: { id: string; label: string }[] = [];
  if (doc.favicon?.assetId) {
    assetRefs.push({ id: doc.favicon.assetId, label: tr("The favicon") });
  }
  if (doc.appleTouchIcon?.assetId) {
    assetRefs.push({ id: doc.appleTouchIcon.assetId, label: tr("Home screen icon") });
  }
  if (doc.ogImage?.assetId) {
    assetRefs.push({ id: doc.ogImage.assetId, label: tr("The default share image") });
  }
  for (const pageId of published) {
    const page = doc.pages[pageId];
    if (page.ogImage?.assetId) {
      assetRefs.push({ id: page.ogImage.assetId, label: tr("The share image of \"{name}\"", { name: page.name }) });
    }
  }
  for (const node of Object.values(doc.nodes)) {
    for (const ref of [node.image, node.media, ...(node.media?.sources ?? [])]) {
      if (ref?.assetId) assetRefs.push({ id: ref.assetId, label: tr("\"{name}\"", { name: node.name }) });
    }
  }
  for (const ref of assetRefs) {
    if (!doc.assets[ref.id]) {
      results.push({
        help: "img-add",
        level: "error",
        message: tr("{label} refers to an asset that doesn't exist", { label: ref.label }),
      });
    }
  }

  const earlierRedirects: Page[] = [];
  for (const pageId of published) {
    const page = doc.pages[pageId];
    if (page.redirectTo !== undefined || page.rewriteTo !== undefined) {
      registerRoute(page);
      if (!page.redirectTo?.trim() && !page.rewriteTo?.trim()) {
        results.push({
          help: "page-redirect",
          level: "error",
          message: tr("Redirect page \"{name}\" has no redirect target or external site set", { name: page.name }),
        });
      } else if (
        page.redirectTo?.trim() &&
        !/^\/(?!\/)/.test(page.redirectTo.trim()) &&
        !/^https?:\/\//i.test(page.redirectTo.trim())
      ) {
        results.push({
          help: "page-redirect",
          level: "error",
          message: tr("The 301 target of redirect page \"{name}\" must be a site URL starting with / or an http(s) URL", { name: page.name }),
        });
      } else if (hasSelfRedirect(page, earlierRedirects)) {
        results.push({
          help: "page-redirect",
          level: "error",
          message: tr("The 301 target \"{destination}\" of redirect page \"{name}\" matches its own source URL, which causes a redirect loop. Change it to a different path.", { name: page.name, destination: page.redirectTo!.trim() }),
        });
      } else if (
        page.rewriteTo?.trim() &&
        !/^https?:\/\/[^/?#]+/i.test(page.rewriteTo.trim())
      ) {
        results.push({
          help: "page-redirect",
          level: "error",
          message: tr("The external site of redirect page \"{name}\" must be a URL starting with http(s)://", { name: page.name }),
        });
      }
      if (page.redirectTo?.trim()) earlierRedirects.push(page);
      continue;
    }
    if (page.rawHtml?.trim()) {
      registerRoute(page);
      continue;
    }
    registerRoute(page, true);

    let hasH1 = false;
    // スクリプトの「ページを開いたとき」のデータのブロック
    const loadVars = new Set<string>();
    const dataSteps = pageDataSteps(doc, page.id);
    for (const st of dataSteps) {
      if (!isDataStep(st)) {
        if ("into" in st && st.into) loadVars.add(st.into);
        continue;
      }
      if (st.as) loadVars.add(st.as);
      if (!st.url.trim()) {
        results.push({
          help: "data-fetch",
          level: "error",
          message: tr("A script on \"{name}\" fetches data from an empty URL", { name: page.name }),
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
          if (st.kind === "if") {
            // 条件ごとに対象がある。最初の条件だけを確かめると、「かつ」「または」でつないだ
            // 条件の中の壊れた参照を見落とす。
            for (const condition of [st.cond, ...(st.conditions ?? [])]) {
              if (condition.subject !== "var" && condition.target !== SELF_TARGET)
                scriptRefs.push({ name: node.name, targetId: condition.target });
            }
          } else if ("target" in st && st.target !== SELF_TARGET) {
            scriptRefs.push({ name: node.name, targetId: st.target });
          }
          if (st.kind === "open-page" && !doc.pages[st.pageId]) {
            results.push({
              help: "act-link",
              level: "warn",
              message: tr("A script on \"{name2}\" in \"{name}\" opens a page that isn't selected or was deleted", { name: page.name, name2: node.name }),
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
            message: tr("The link target of \"{name2}\" in \"{name}\" was deleted (it will link to the home page)", { name: page.name, name2: node.name }),
          });
        } else if (target.unpublished) {
          results.push({
            help: "page-draft",
            level: "warn",
            message: tr("\"{name2}\" in \"{name}\" links to \"{name3}\", which is unpublished (it will be a 404)", { name: page.name, name2: node.name, name3: target.name }),
          });
        }
      }
      if (node.type === "list" && !listFromOf(node)) {
        results.push({
          help: "data-list",
          level: "warn",
          message: tr("List display \"{name2}\" in \"{name}\" has no list selected (it won't be output)", { name: page.name, name2: node.name }),
        });
      }
      if (node.type === "image" && node.image && !node.image.alt) {
        results.push({
          help: "img-alt",
          level: "warn",
          message: tr("Image \"{name2}\" in \"{name}\" has no alt text", { name: page.name, name2: node.name }),
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
          message: tr("Form field \"{name2}\" in \"{name}\" has no ID attribute (its value won't be submitted or usable as a {variable})", { name: page.name, name2: node.name }),
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
          message: tr("A script on \"{name2}\" in \"{name}\" has a block with no target selected", { name: page.name, name2: t.name }),
        });
      } else if (!idCount.has(t.targetId)) {
        results.push({
          help: "act-script",
          level: "warn",
          message: tr("The target ID \"{targetId}\" in the script on \"{name2}\" in \"{name}\" isn't on this page", { name: page.name, name2: t.name, targetId: t.targetId }),
        });
      }
    }
    for (const [aid, n] of idCount) {
      if (n > 1) {
        results.push({
          help: "act-anchor",
          level: "warn",
          message: tr("The ID \"{aid}\" is used by {n} elements in \"{name}\" (variables and anchors won't work correctly)", { name: page.name, aid, n }),
        });
      }
    }
    if (page.slug.includes("[slug]") && idCount.has("slug")) {
      results.push({
        help: "data-detail",
        level: "warn",
        message: tr("The ID \"slug\" in [slug] page \"{name}\" conflicts with the page variable {slug} (use a different ID)", { name: page.name }),
      });
    }
    if (page.slug.includes("[slug]") && !hasData) {
      results.push({
        help: "data-detail",
        level: "warn",
        message: tr("[slug] page \"{name}\" doesn't fetch any data (in its \"When the page opens\" script, fetch one item using {slug})", { name: page.name }),
      });
    }
    if (!hasH1) {
      results.push({
        help: "text-heading",
        level: "warn",
        message: tr("\"{name}\" has no Heading 1 (h1)", { name: page.name }),
      });
    }
  }
  results.push(...componentCycleChecks(doc, published));
  return results;
}

/** スマホの画面幅の目安（はみ出しの判定に使う） */
const PHONE_WIDTH = 375;

/** リンクの文字として使うと、行き先が伝わらない言葉 */
const VAGUE_LINK_TEXT = /^(こちら|ここ|こちらから|こちらをクリック|ここをクリック|クリック|click here|here|more)$/i;

/** "16px" / "1.5rem" を px に換算する（それ以外の単位は判定しない） */
function toPx(v: string | undefined): number | null {
  const m = /^(-?\d*\.?\d+)(px|rem)$/.exec(v?.trim() ?? "");
  if (!m) return null;
  return m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
}

/** 押すとページや URL を開く要素か */
function opensLink(node: DocNode): boolean {
  if (node.link) return true;
  return !!node.scripts?.some(
    (sc) =>
      sc.trigger === "click" &&
      sc.steps.some((st) => st.kind === "open-page" || st.kind === "open-url")
  );
}

/** 「〇〇」ほか N 件 */
function namesText(names: string[]): string {
  const first = tr("\"{name}\"", { name: names[0] });
  return names.length > 1 ? tr("{first} and {n} more", { first, n: names.length - 1 }) : first;
}

/**
 * ウェブデザインの慣例に照らした注意（公開はできる）。
 * スマホで読めない小さな文字・画面からはみ出す固定の幅・見出しの段の飛ばし・行き先の分からないリンク
 */
function designChecks(doc: SiteDoc, page: Page): CheckResult[] {
  const out: CheckResult[] = [];
  const small = BP_ORDER.length > 1 ? BP_ORDER[BP_ORDER.length - 1] : null;
  const headings: number[] = [];
  const tiny: string[] = [];
  const wide: { id: string; name: string; width: number }[] = [];
  const vague: { name: string; text: string }[] = [];

  /** inWide = 親がすでにはみ出している（中の要素は親を直せば収まるため、幅では数えない） */
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
      // 画像は公開サイトでも親の幅を超えないため、除く
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
      message: tr("\"{name}\" has text smaller than 12px on phones, which is hard to read ({p2})", { name: page.name, p2: namesText(tiny) }),
    });
  }
  if (wide.length) {
    out.push({
      help: "d-units",
      level: "warn",
      message: tr("{p2} in \"{name}\" has a fixed width of {width}px and overflows phone screens (about {PHONE_WIDTH}px wide). Use a % width or add a max width.", { name: page.name, p2: namesText(wide.map((w) => w.name)), width: wide[0].width, PHONE_WIDTH }),
    });
  }
  const h1 = headings.filter((h) => h === 1).length;
  if (h1 > 1) {
    out.push({
      help: "text-heading",
      level: "warn",
      message: tr("\"{name}\" has {h1} Heading 1s (use Heading 1 only for the page title)", { name: page.name, h1 }),
    });
  }
  for (let i = 1; i < headings.length; i++) {
    if (headings[i] > headings[i - 1] + 1) {
      out.push({
        help: "text-heading",
        level: "warn",
        message: tr("In \"{name}\", Heading {p2} is followed by Heading {p3} (go down one level at a time)", { name: page.name, p2: headings[i - 1], p3: headings[i] }),
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
          ? tr("A link in \"{name}\" says \"{text}\" (and {n} more). Use words that describe where it goes.", { name: page.name, text: vague[0].text, n: vague.length - 1 })
          : tr("A link in \"{name}\" says \"{text}\". Use words that describe where it goes.", { name: page.name, text: vague[0].text }),
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
 * 公開サイトでは表示が無限に続いてページを表示できないため、使っていれば公開を止める
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
    message: tr("Component \"{name}\" contains itself, so it would nest forever. Remove its own instance from the main component.", { name: c.name }),
  }));
}
