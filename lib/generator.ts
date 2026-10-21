import type { SiteDoc } from "./types";
import { applyBreakpoints } from "./style";
import { siteLangOf, siteText } from "./site-lang";
import { INVIEW_SCRIPT } from "./motion";
import { fieldVarNames } from "./fields";
import { VARS_RUNTIME } from "./vars";
import { idVarNodesOf, obfuscateVarNames, pagePlan } from "./data";
import { hasRunnableScripts, listFilterFields, scriptTargetIds } from "./script";
import { compactJs, scriptsFile, usesLiveFields } from "./script-runtime";
import { cssValue, generateSiteCss, rawHtmlWithBodyStyles, usedGoogleFonts } from "./generator/css";
import { headHtmlToJsx } from "./generator/head";
import { SAFE_FETCH_SOURCE } from "./generator/safe-fetch-source";
import { buildAssetNames, buildClassNames, buildComponentNames } from "./generator/names";
import { generatePageFile, queryDispatcherFile, routeDir, unnestLinks } from "./generator/page";
import { imageRefSrc, jsxString, smartLinkComponent } from "./generator/render-helpers";
import { renderNode, type JsxContext } from "./generator/render";
import {
  PAGE_HTML_COMPONENT,
  PWA_REGISTER_SCRIPT,
  PWA_SERVICE_WORKER,
  SEARCH_FORM_COMPONENT,
  generatedReadme,
  pwaIconType,
  versionedSrc,
} from "./generator/templates";

export interface GeneratedProject {
  /** パス → テキスト内容 */
  files: Record<string, string>;
  /** パス → base64（dataURL形式のアセット） */
  binaries: Record<string, string>;
  /** パス → Workers KV 上のアセットのキー（公開時にサーバーが読み込んでコミットする） */
  remoteAssets: Record<string, string>;
}

/** 公開先。テストサイトは検索エンジンに載らないよう多重に防御して生成する */
export type PublishTarget = "test" | "production";

/** テストサイトの全レスポンスに付けるヘッダー値 */
const TEST_ROBOTS_HEADER = "noindex, nofollow, noarchive, nosnippet, noimageindex";

/** テストサイトで403を返すクローラーのUser-Agent（部分一致・大文字小文字無視） */
const TEST_BLOCKED_BOTS = [
  "bot",
  "crawler",
  "spider",
  "slurp",
  "facebookexternalhit",
  "embedly",
  "quora link preview",
  "whatsapp",
  "ia_archiver",
  "mediapartners-google",
  "adsbot",
  "google-inspectiontool",
  "googleother",
  "google-extended",
  "feedfetcher",
  "headlesschrome",
];

/* ---------- プロジェクト全体 ---------- */

export function generateProject(
  doc: SiteDoc,
  target: PublishTarget = "production"
): GeneratedProject {
  // 配信するコードに変数名を出さない（編集中のデータはそのまま）
  doc = obfuscateVarNames(doc);
  // 複製した doc なので書き換えてよい
  unnestLinks(doc);
  // メディアクエリの幅はサイトのブレークポイント設定から作る
  applyBreakpoints(doc);
  const isTest = target === "test";
  const siteLang = siteLangOf(doc);
  const classNames = buildClassNames(doc);
  const componentNames = buildComponentNames(doc);
  const assetNames = buildAssetNames(doc);
  const ctx: JsxContext = {
    doc,
    classNames,
    componentNames,
    usesImage: false,
    usesLink: false,
    usesSearchForm: false,
    usesInterpolate: false,
    usedComponents: new Set(),
    // 要素のスクリプトと「このページ」のスクリプト（開いたときに表示するなど）で表示する対象
    toggleTargets: new Set([
      ...Object.values(doc.nodes).flatMap((n) => scriptTargetIds(n, ["show", "toggle"])),
      ...Object.values(doc.pages).flatMap((p) =>
        scriptTargetIds({ scripts: p.pageScripts }, ["show", "toggle"])
      ),
    ]),
    listFilterFields: listFilterFields(doc),
    liveNames: new Set(),
    assetNames,
  };
  const files: Record<string, string> = {};
  const binaries: Record<string, string> = {};
  const configSource = (slug: string) => {
    const route = slug.replace(/^\/+|\/+$/g, "");
    if (!route) return "/";
    return `/${route.replace(/\[\.\.\.([^\]]+)\]/g, ":$1*").replace(/\[([^\]]+)\]/g, ":$1")}`;
  };
  const routedPages = doc.pageOrder
    .map((id) => doc.pages[id])
    .filter((page) => !page.unpublished);
  const redirects = routedPages
    .filter((page) => page.redirectTo?.trim())
    .map((page) => ({
      source: configSource(page.slug),
      destination: page.redirectTo!.trim(),
      statusCode: 301,
    }));
  // リバースプロキシ: ページURLのまま外部サイトの内容を中継する。
  // 外部サイトの相対パス（CSS・画像・下層ページ）も届くよう、配下のパスも同じ先へ中継する
  const rewrites = routedPages
    .filter((page) => page.rewriteTo?.trim())
    .flatMap((page) => {
      const source = configSource(page.slug);
      const destination = page.rewriteTo!.trim();
      const rules = [{ source, destination }];
      if (source !== "/" && !source.includes("*") && !/[?#]/.test(destination)) {
        rules.push({
          source: `${source}/:proxyPath*`,
          destination: `${destination.replace(/\/+$/, "")}/:proxyPath*`,
        });
      }
      return rules;
    });

  /** 同じURLを共有する通常ページ（クエリ違い）。1つだけなら空 */
  const queryVariantsOf = (slug: string): string[] => {
    const ids = routedPages
      .filter(
        (p) =>
          p.redirectTo === undefined &&
          p.rewriteTo === undefined &&
          !p.rawHtml?.trim() &&
          p.slug.replace(/^\/+|\/+$/g, "") === slug
      )
      .map((p) => p.id);
    return ids.length > 1 ? ids : [];
  };

  // ページ（非公開は除外）
  let anySearchForm = false;
  let anySmartLink = false;
  for (const pageId of doc.pageOrder) {
    const page = doc.pages[pageId];
    if (page.unpublished) continue;
    if (page.redirectTo !== undefined || page.rewriteTo !== undefined) continue;
    const slug = page.slug.replace(/^\/+|\/+$/g, "");
    const dir = routeDir(slug);
    if (page.rawHtml?.trim()) {
      // HTMLページ: Route Handler でそのまま配信（script / css込みで動く）
      const path = dir ? `app/${dir}/route.ts` : "app/route.ts";
      const htmlWithAssets = rawHtmlWithBodyStyles(
        doc,
        page,
        cssValue(doc, "rawHtml", page.rawHtml, assetNames),
        assetNames
      );
      files[path] = `const html = ${JSON.stringify(htmlWithAssets)};

export const dynamic = "force-static";

export function GET() {
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
`;
      continue;
    }
    // URLが「404」のページは、存在しないURLで表示される not-found.tsx になる
    const routePath =
      slug === "404"
        ? "app/not-found.tsx"
        : dir
          ? `app/${dir}/page.tsx`
          : "app/page.tsx";
    // 同じURLをクエリで分けたページは、_q/ に置いて page.tsx で振り分ける
    const variants = slug === "404" ? [] : queryVariantsOf(slug);
    const variantIndex = variants.indexOf(pageId);
    const path =
      variantIndex < 0
        ? routePath
        : `${routePath.replace(/page\.tsx$/, "")}_q/p${variantIndex}.tsx`;
    if (variantIndex === 0) {
      files[routePath] = queryDispatcherFile(
        variants.map((id) => doc.pages[id].query)
      );
    }
    files[path] = generatePageFile(ctx, pageId, { notFound: slug === "404" });
    if (ctx.usesSearchForm) anySearchForm = true;
    if (ctx.usesSmartLink) anySmartLink = true;
    if (ctx.usesPageHtml) files["components/PageHtml.tsx"] = PAGE_HTML_COMPONENT;
    if (ctx.usesInterpolate || files[path].includes("@/lib/vars")) {
      files["lib/vars.ts"] = VARS_RUNTIME;
    }
  }

  // サイト全体で画面上から値が変わる変数（コンポーネントやローディング画面内のスクリプトで残す）
  const siteLiveNames = new Set<string>();
  for (const p of Object.values(doc.pages)) {
    for (const v of pagePlan(doc, p.id).clientVars) siteLiveNames.add(v);
    for (const n of idVarNodesOf(doc, p.id)) {
      if (n.type === "field") fieldVarNames(n).forEach((v) => siteLiveNames.add(v));
    }
  }
  for (const n of Object.values(doc.nodes)) {
    if (n.type === "field") fieldVarNames(n).forEach((v) => siteLiveNames.add(v));
  }

  // コンポーネント（1コンポーネント = 1ファイル）
  for (const comp of Object.values(doc.components ?? {})) {
    const name = componentNames.get(comp.id)!;
    ctx.usesImage = false;
    ctx.usesLink = false;
    ctx.usesSmartLink = false;
    ctx.usesFragment = false;
    ctx.usesSearchForm = false;
    ctx.usesInterpolate = false;
    ctx.usesLookup = false;
    ctx.usesTemplate = false;
    ctx.inTemplate = false;
    ctx.inForm = false;
    ctx.usedComponents = new Set();
    ctx.varsExpr = "{}";
    ctx.listVars = undefined;
    ctx.listOps = undefined;
    ctx.liveNames = new Set(siteLiveNames);
    const body = renderNode(ctx, comp.rootId, "    ", false);
    ctx.varsExpr = "vars";
    const imports: string[] = [];
    if (ctx.usesFragment) imports.push('import { Fragment } from "react";');
    if (ctx.usesLink) imports.push('import Link from "next/link";');
    if (ctx.usesSmartLink) {
      anySmartLink = true;
      imports.push('import SmartLink from "./SmartLink";');
    }
    if (ctx.usesImage) imports.push('import Image from "next/image";');
    if (ctx.usesSearchForm) {
      anySearchForm = true;
      imports.push('import SearchForm from "./SearchForm";');
    }
    if (ctx.usesInterpolate) {
      imports.push(`import { safeNavigationUrl, interpolate, interpolateUrl${ctx.usesLookup ? ", lookupVar" : ""} } from "@/lib/vars";`);
      files["lib/vars.ts"] = VARS_RUNTIME;
    }
    for (const usedId of ctx.usedComponents) {
      if (usedId === comp.id) continue;
      const usedName = componentNames.get(usedId)!;
      imports.push(`import ${usedName} from "./${usedName}";`);
    }
    files[`components/${name}.tsx`] = `${
      imports.length ? imports.join("\n") + "\n\n" : ""
    }export default function ${name}() {
  return (
${body || "    null"}
  );
}
`;
  }

  if (anySearchForm) {
    files["components/SearchForm.tsx"] = SEARCH_FORM_COMPONENT;
  }
  if (Object.values(files).some((source) => source.includes('from "@/lib/safe-fetch"'))) {
    files["lib/safe-fetch.ts"] = SAFE_FETCH_SOURCE;
  }
  if (anySmartLink) {
    files["components/SmartLink.tsx"] = smartLinkComponent(doc);
  }

  // フォント
  const fonts = usedGoogleFonts(doc);
  const fontImports = fonts.length
    ? `import { ${fonts.map((f) => f.google!.importName).join(", ")} } from "next/font/google";\n`
    : "";
  const fontDecls = fonts
    .map((f) => {
      const g = f.google!;
      const varName = g.importName.replace(/_/g, "").toLowerCase();
      const weights = g.weights
        ? `, weight: ${JSON.stringify(g.weights)}`
        : "";
      return `const ${varName} = ${g.importName}({ subsets: ["latin"], variable: "${g.cssVar}"${weights} });`;
    })
    .join("\n");
  const fontClassList = fonts
    .map((f) => `\${${f.google!.importName.replace(/_/g, "").toLowerCase()}.variable}`)
    .join(" ");
  const bodyClass = fonts.length ? ` className={\`${fontClassList}\`}` : "";

  const layoutMeta: string[] = [];
  const siteUrl = doc.siteUrl?.trim();
  if (siteUrl && /^https?:\/\//.test(siteUrl)) {
    layoutMeta.push(`  metadataBase: new URL(${JSON.stringify(siteUrl)}),`);
  }
  layoutMeta.push(
    `  title: {\n    default: ${JSON.stringify(doc.siteName)},\n    template: ${JSON.stringify(`%s | ${doc.siteName}`)},\n  },`
  );
  const faviconSrc = imageRefSrc(assetNames, doc.favicon);
  const appleIconSrc = imageRefSrc(assetNames, doc.appleTouchIcon);
  if (faviconSrc || appleIconSrc) {
    const icons = [
      faviconSrc ? `icon: ${JSON.stringify(faviconSrc)}` : null,
      appleIconSrc ? `apple: ${JSON.stringify(appleIconSrc)}` : null,
    ].filter(Boolean);
    layoutMeta.push(`  icons: { ${icons.join(", ")} },`);
  }
  // ページ側でopenGraphを出さない場合（[slug]ページ等）のフォールバック
  const defaultOgSrc = imageRefSrc(assetNames, doc.ogImage);
  if (defaultOgSrc) {
    layoutMeta.push(
      `  openGraph: {\n    siteName: ${JSON.stringify(doc.siteName)},\n    images: [${JSON.stringify(defaultOgSrc)}],\n  },`
    );
    layoutMeta.push(`  twitter: { card: "summary_large_image" },`);
  }
  if (isTest) {
    layoutMeta.push(
      `  robots: {\n    index: false,\n    follow: false,\n    nocache: true,\n    googleBot: { index: false, follow: false, noimageindex: true },\n  },`
    );
  }

  // PWA: マニフェスト（app/manifest.ts → /manifest.webmanifest）とService Worker
  const pwa = doc.pwa?.enabled ? doc.pwa : null;
  const pwaThemeColor = pwa?.themeColor?.trim();
  if (pwa) {
    const appName = pwa.name?.trim() || doc.siteName;
    const iconRef = [pwa.icon, doc.appleTouchIcon, doc.favicon].find(
      (r) => imageRefSrc(assetNames, r)
    );
    const iconSrc = imageRefSrc(assetNames, iconRef);
    const iconAsset = iconRef?.assetId ? doc.assets[iconRef.assetId] : undefined;
    const icons = iconSrc
      ? [
          {
            src: iconSrc,
            sizes:
              iconAsset?.width && iconAsset?.height
                ? `${iconAsset.width}x${iconAsset.height}`
                : "any",
            ...(pwaIconType(iconAsset?.mimeType, iconSrc)
              ? { type: pwaIconType(iconAsset?.mimeType, iconSrc) }
              : {}),
            purpose: "any",
          },
        ]
      : [];
    const manifest = {
      name: appName,
      short_name: pwa.shortName?.trim() || appName,
      start_url: "/",
      scope: "/",
      display: pwa.display ?? "standalone",
      lang: siteLang,
      ...(pwaThemeColor ? { theme_color: pwaThemeColor } : {}),
      ...(pwa.backgroundColor?.trim()
        ? { background_color: pwa.backgroundColor.trim() }
        : {}),
      icons,
    };
    files["app/manifest.ts"] = `import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return ${JSON.stringify(manifest, null, 2).replace(/\n/g, "\n  ")};
}
`;
    files["public/sw.js"] = compactJs(PWA_SERVICE_WORKER) + "\n";
    files["public/pwa.js"] = compactJs(PWA_REGISTER_SCRIPT) + "\n";
    layoutMeta.push(
      `  appleWebApp: { capable: true, title: ${JSON.stringify(pwa.shortName?.trim() || appName)} },`
    );
  }

  // 「画面に入ったとき」トリガー用のスクリプト
  const needsInView = Object.values(doc.nodes).some((n) =>
    n.motions?.some((m) => m.trigger === "in-view")
  );
  if (needsInView) files["public/inview.js"] = compactJs(INVIEW_SCRIPT) + "\n";

  // 「スクリプト」の実行ランタイム（使う機能だけ）
  const needsScripts =
    Object.values(doc.nodes).some(hasRunnableScripts) ||
    usesLiveFields(doc) ||
    Object.values(doc.pages).some(
      (p) => !p.unpublished && hasRunnableScripts({ scripts: p.pageScripts })
    );
  if (needsScripts) files["public/scripts.js"] = scriptsFile(doc);

  const loading = doc.loadingScreen?.enabled ? doc.loadingScreen : null;
  if (loading) {
    const loadingPage = loading.pageId ? doc.pages[loading.pageId] : null;
    const loadingCtx: JsxContext = {
      ...ctx,
      usesImage: false,
      usesLink: false,
      usesSmartLink: false,
      usesFragment: false,
      usesSearchForm: false,
      usesInterpolate: false,
      usesLookup: false,
      usesTemplate: false,
      inTemplate: false,
      inForm: false,
      usedComponents: new Set(),
      varsExpr: "{}",
      listVars: undefined,
      listOps: undefined,
      liveNames: new Set(siteLiveNames),
    };
    const loadingBody = loadingPage
      ? loadingPage.children
          .map((id) => renderNode(loadingCtx, id, "      ", true))
          .filter(Boolean)
          .join("\n")
      : "";
    const loadingImports: string[] = [];
    if (loadingCtx.usesImage) {
      loadingImports.push('import Image from "next/image";');
    }
    if (loadingCtx.usesLink) {
      loadingImports.push('import Link from "next/link";');
    }
    if (loadingCtx.usesSmartLink) {
      loadingImports.push('import SmartLink from "@/components/SmartLink";');
      files["components/SmartLink.tsx"] ??= smartLinkComponent(doc);
    }
    if (loadingCtx.usesFragment) {
      loadingImports.push('import { Fragment } from "react";');
    }
    if (loadingCtx.usesSearchForm) {
      loadingImports.push('import SearchForm from "@/components/SearchForm";');
      files["components/SearchForm.tsx"] ??= SEARCH_FORM_COMPONENT;
    }
    if (loadingCtx.usesInterpolate) {
      loadingImports.push(
        `import { safeNavigationUrl, interpolate, interpolateUrl${loadingCtx.usesLookup ? ", lookupVar" : ""} } from "@/lib/vars";`
      );
      files["lib/vars.ts"] = VARS_RUNTIME;
    }
    for (const componentId of loadingCtx.usedComponents) {
      const name = componentNames.get(componentId);
      if (name) {
        loadingImports.push(
          `import ${name} from "@/components/${name}";`
        );
      }
    }
    const fallbackBody = `<div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <span style={{ width: 32, height: 32, border: "3px solid currentColor", borderRightColor: "transparent", borderRadius: "50%", animation: "loading-spin 700ms linear infinite" }} />
      </div>`;
    files["components/SiteLoadingScreen.tsx"] = `"use client";

import { useEffect, useState } from "react";
${loadingImports.length ? loadingImports.join("\n") + "\n" : ""}

const MIN_DURATION = ${Math.max(0, loading.minDuration ?? 500)};
const FADE_DURATION = ${Math.max(0, loading.fadeDuration ?? 300)};
const SHOW_ONCE = ${!!loading.showOnce};

export default function SiteLoadingScreen() {
  const [leaving, setLeaving] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const wasShown = () => {
      try {
        return sessionStorage.getItem("site-loading-shown") === "1";
      } catch {
        return false;
      }
    };
    const markShown = () => {
      try {
        sessionStorage.setItem("site-loading-shown", "1");
      } catch {
        // ストレージが無効でもローディング画面は閉じる
      }
    };
    if (SHOW_ONCE && wasShown()) {
      setHidden(true);
      return;
    }
    const started = Date.now();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      fadeTimer = setTimeout(() => {
        setLeaving(true);
        if (SHOW_ONCE) markShown();
        hideTimer = setTimeout(() => {
          document.body.style.overflow = previousOverflow;
          setHidden(true);
        }, FADE_DURATION);
      }, Math.max(0, MIN_DURATION - (Date.now() - started)));
    };
    if (document.readyState === "complete") finish();
    else window.addEventListener("load", finish, { once: true });
    return () => {
      window.removeEventListener("load", finish);
      if (fadeTimer) clearTimeout(fadeTimer);
      if (hideTimer) clearTimeout(hideTimer);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  if (hidden) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label=${jsxString(siteText(siteLang, "loading"))}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        overflow: "auto",
        background: "#ffffff",
        color: "#18181b",
        opacity: leaving ? 0 : 1,
        transition: \`opacity \${FADE_DURATION}ms ease\`,
        pointerEvents: leaving ? "none" : "auto",
      }}
    >
${loadingBody || `      ${fallbackBody}`}
      ${loadingPage ? "" : "<style>{`@keyframes loading-spin { to { transform: rotate(360deg); } }`}</style>"}
    </div>
  );
}
`;
  }

  const headHtml = doc.customHeadHtml?.trim();
  // サイトのスクリプトは React の描画（ハイドレーション）が終わってから動かす。
  // 先に動くと、表示の切り替えやリストの描画がハイドレーションとぶつかる
  const siteScripts = [
    needsInView ? versionedSrc("/inview.js", files["public/inview.js"]) : "",
    needsScripts ? versionedSrc("/scripts.js", files["public/scripts.js"]) : "",
    pwa ? versionedSrc("/pwa.js", files["public/pwa.js"]) : "",
  ].filter(Boolean);
  const scriptTags = siteScripts
    .map((src) => `\n        <Script src=${jsxString(src)} strategy="afterInteractive" />`)
    .join("");
  const bodyEndHtml = doc.customBodyEndHtml?.trim() ?? "";
  // <head> を dangerouslySetInnerHTML にすると、ページ遷移で React が <head> の中身を置き換え、
  // Next.js が入れた CSS の <link> まで消える。要素ごとに JSX にして <head> の子として出す
  const headTag = headHtml ? `\n      <head>${headHtmlToJsx(headHtml, "        ")}\n      </head>` : "";
  const bodyEndTag = bodyEndHtml
    ? `\n        <div\n          dangerouslySetInnerHTML={{ __html: ${JSON.stringify(bodyEndHtml)} }}\n        />`
    : "";

  const viewportExport = pwaThemeColor
    ? `\nexport const viewport: Viewport = {\n  themeColor: ${JSON.stringify(pwaThemeColor)},\n};\n`
    : "";
  files["app/layout.tsx"] = `import type { Metadata${pwaThemeColor ? ", Viewport" : ""} } from "next";
${fontImports}${siteScripts.length ? 'import Script from "next/script";\n' : ""}${loading ? 'import SiteLoadingScreen from "@/components/SiteLoadingScreen";\n' : ""}import "./globals.css";
import "../styles/site.css";

export const metadata: Metadata = {
${layoutMeta.join("\n")}
};
${viewportExport}${fontDecls ? "\n" + fontDecls + "\n" : ""}
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang=${jsxString(siteLang)}>${headTag}
      <body${bodyClass}>
        ${loading ? "<SiteLoadingScreen />\n        " : ""}{children}${scriptTags}${bodyEndTag}
      </body>
    </html>
  );
}
`;

  files["app/globals.css"] = `*,
*::before,
*::after {
  box-sizing: border-box;
}

/* 画面端からはみ出した要素で横スクロールが出ないようにする。
   body は clip にして position: sticky を壊さない（hidden だとスクロールコンテナになる） */
html {
  overflow-x: hidden;
}

body {
  overflow-x: clip;
  margin: 0;
  font-family: system-ui, -apple-system, "Hiragino Sans", sans-serif;
  color: #18181b;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4, h5, h6, p, [data-p], ul, ol {
  margin: 0;
  white-space: pre-wrap;
}

img, video {
  display: block;
}

/* エディタのキャンバスと同じく、画像は親の幅を超えない */
img {
  max-width: 100%;
}

/* 端末で「視差効果を減らす」を選んでいる人には、動きをすぐ終わらせる（最後の見た目は保つ） */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    transition-delay: 0s !important;
    scroll-behavior: auto !important;
  }
}

/* シャドウ付きSVGのiOS Safari向けぼやけ対策（要素側のスタイルが優先されるよう詳細度0）。
   position を付けると後ろの兄弟より前面に描かれてしまうため、グリッドで重ねる。
   hidden だとフレックス内で縮んでしまうため clip（縮小後の画像は箱に収まるので非対応環境でも見た目は同じ） */
:where(.crisp-svg) {
  display: grid;
  overflow: clip;
}

.crisp-svg > svg {
  grid-area: 1 / 1;
  display: block;
  width: 100%;
  height: auto;
}

/* contain: size と aspect-ratio: auto で画像自身の大きさを箱の大きさに影響させない */
.crisp-svg > img {
  grid-area: 1 / 1;
  contain: size;
  aspect-ratio: auto;
  width: 200%;
  height: 200%;
  max-width: none;
  object-fit: inherit;
  transform: scale(0.5);
  transform-origin: 0 0;
}

input, textarea, select, button {
  font: inherit;
  color: inherit;
}

a {
  color: inherit;
  text-decoration: none;
}
`;

  files["app/not-found.tsx"] ??= `export default function NotFound() {
  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 64, margin: 0 }}>404</h1>
        <p>${siteText(siteLang, "notFound")}</p>
      </div>
    </main>
  );
}
`;

  files["styles/site.css"] = generateSiteCss(doc, classNames, assetNames);

  // アセット
  const remoteAssets: Record<string, string> = {};
  for (const asset of Object.values(doc.assets)) {
    const path = `public/assets/${assetNames.get(asset.id)}`;
    if (asset.path) {
      remoteAssets[path] = asset.path;
    } else if (asset.dataUrl) {
      // data:image/svg+xml;charset=utf-8;base64,… や base64でない形式も受け付ける
      const m = /^data:([^,]*?)(;base64)?,([\s\S]*)$/.exec(asset.dataUrl);
      if (m) {
        binaries[path] = m[2]
          ? m[3].replace(/\s+/g, "")
          : utf8ToBase64(decodeURIComponent(m[3]));
      }
    }
  }

  const siteSlug =
    doc.siteName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "my-site";
  // テストサイトは同じリポジトリの別ブランチなので、本番と同じ Worker のプレビュー版になる
  const workerName = siteSlug;

  files["package.json"] = JSON.stringify(
    {
      name: siteSlug,
      private: true,
      version: "0.1.0",
      engines: { node: "^22.16.0 || >=24.0.0" },
      scripts: {
        dev: "next dev",
        build: "next build",
        start: "next start",
        preview: "opennextjs-cloudflare build && opennextjs-cloudflare preview",
        deploy: "opennextjs-cloudflare build && opennextjs-cloudflare deploy",
      },
      dependencies: {
        next: "^16.4.2",
        react: "^19.1.0",
        "react-dom": "^19.1.0",
      },
      devDependencies: {
        "@opennextjs/cloudflare": "^1.20.12",
        "@types/node": "^22",
        "@types/react": "^19",
        "@types/react-dom": "^19",
        typescript: "^5",
        wrangler: "^4.151.1",
      },
      // Next.js / OpenNext が固定している間接依存も修正版にする。
      overrides: {
        next: { postcss: "^8.5.30" },
        "@node-minify/core": { glob: "^10.5.0" },
      },
    },
    null,
    2
  ) + "\n";

  // Cloudflare Workers（OpenNext）で動かすための設定
  files["wrangler.jsonc"] = `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": ${JSON.stringify(workerName)},
  "main": ".open-next/worker.js",
  "compatibility_date": "2025-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  }
}
`;

  files["open-next.config.ts"] = `import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
`;

  files["next.config.mjs"] = `/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Cloudflare Workers には Next.js の画像最適化サーバーが無いため無効化
    unoptimized: true,
  },${
    isTest
      ? `
  async headers() {
    // テストサイト: 全ページを検索エンジンの対象外にする
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: ${JSON.stringify(TEST_ROBOTS_HEADER)} }],
      },
    ];
  },`
      : ""
  }${
    redirects.length
      ? `
  async redirects() {
    return ${JSON.stringify(redirects, null, 4)};
  },`
      : ""
  }${
    rewrites.length
      ? `
  async rewrites() {
    return {
      beforeFiles: ${JSON.stringify(rewrites, null, 6)},
    };
  },`
      : ""
  }
};

export default nextConfig;
`;

  files["tsconfig.json"] = JSON.stringify(
    {
      compilerOptions: {
        target: "ES2020",
        lib: ["dom", "dom.iterable", "esnext"],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: "react-jsx",
        incremental: true,
        plugins: [{ name: "next" }],
        paths: { "@/*": ["./*"] },
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
      exclude: ["node_modules"],
    },
    null,
    2
  ) + "\n";

  files[".gitignore"] = `node_modules/
.next/
.open-next/
.wrangler/
out/
.env*
!.env.example
.dev.vars*
`;

  files["README.md"] = generatedReadme(doc.siteName, doc.hosting === "cloudflare");

  if (isTest) addTestSiteGuards(files);

  return { files, binaries, remoteAssets };
}

/**
 * テストサイト用の検索エンジン対策。どれか1つが効かなくても他で防げるよう重ねる。
 * - robots.txt で全URLのクロールを禁止
 * - ミドルウェアでクローラーのUser-Agentを403で拒否し、X-Robots-Tag を付与
 * - 静的ファイル（Workers Static Assets から直接配信される分）にも _headers で X-Robots-Tag
 * - レイアウトの robots メタ（generateProject 内）と next.config の headers
 */
function addTestSiteGuards(files: Record<string, string>) {
  // ユーザーが作った robots.txt / sitemap のページは公開しない
  for (const path of Object.keys(files)) {
    if (/^app\/(robots\.txt|sitemap[^/]*\.xml)\//.test(path)) delete files[path];
  }
  files["public/robots.txt"] = "User-agent: *\nDisallow: /\n";
  files["public/_headers"] = `/*\n  X-Robots-Tag: ${TEST_ROBOTS_HEADER}\n`;
  files["middleware.ts"] = `import { NextResponse, type NextRequest } from "next/server";

// テストサイト: 検索エンジン等のクローラーを拒否する（エディタが自動生成）
const ROBOTS = ${JSON.stringify(TEST_ROBOTS_HEADER)};
const BLOCKED = new RegExp(${JSON.stringify(
    TEST_BLOCKED_BOTS.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
  )}, "i");

export function middleware(req: NextRequest) {
  const ua = req.headers.get("user-agent") ?? "";
  if (req.nextUrl.pathname !== "/robots.txt" && BLOCKED.test(ua)) {
    return new NextResponse("Forbidden", {
      status: 403,
      headers: { "X-Robots-Tag": ROBOTS, "Content-Type": "text/plain" },
    });
  }
  const res = NextResponse.next();
  res.headers.set("X-Robots-Tag", ROBOTS);
  return res;
}

export const config = {
  matcher: "/:path*",
};
`;
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
