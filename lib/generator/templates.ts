/**
 * 書き出すプロジェクトに入れる定型のファイル（PWA・HTMLページ・検索フォーム・README）
 */

import { getLang } from "../i18n";

/** 画像の URL が空のときに使う、1×1 の透明な GIF */
export const EMPTY_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** PWA のアイコンの MIME タイプ（分からなければ undefined） */
export function pwaIconType(mimeType: string | undefined, src: string): string | undefined {
  if (mimeType?.startsWith("image/")) return mimeType;
  const ext = src.split(/[?#]/)[0].split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    ico: "image/x-icon",
  };
  return ext ? types[ext] : undefined;
}

/** PWA の Service Worker を登録する */
export const PWA_REGISTER_SCRIPT = `
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function () {});
}
`;

/**
 * PWA の Service Worker。常にネットワークを優先し（更新がすぐに反映される）、
 * オフラインのときだけ、最後に表示したページやファイルを返す。
 */
export const PWA_SERVICE_WORKER = `
var CACHE = "site-pwa-v2";
self.addEventListener("install", function () {
  self.skipWaiting();
});
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k.indexOf("site-pwa-") === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || req.headers.has("Authorization") || req.headers.has("RSC") || url.searchParams.has("_rsc")) return;
  e.respondWith(
    fetch(req).then(function (res) {
      var control = res.headers.get("Cache-Control") || "";
      // 個人用・非キャッシュのページを、ログアウト後もオフラインで見せない。
      // 明示的に public の応答だけを保存する（ブラウザの Cache API はこれを自動では守らない）。
      if (res.ok && res.type === "basic" && /(?:^|,)\\s*public(?:\\s|,|$)/i.test(control) && !/(?:^|,)\\s*(?:private|no-store|no-cache)(?:\\s|,|=|$)/i.test(control)) {
        var copy = res.clone();
        e.waitUntil(caches.open(CACHE).then(function (c) { return c.put(req, copy); }));
      } else {
        e.waitUntil(caches.open(CACHE).then(function (c) { return c.delete(req); }));
      }
      return res;
    }).catch(function () {
      return caches.open(CACHE).then(function (c) { return c.match(req); }).then(function (hit) { return hit || Response.error(); });
    })
  );
});
`;

export function versionedSrc(src: string, content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h = Math.imul(h ^ content.charCodeAt(i), 0x01000193);
  }
  return `${src}?v=${(h >>> 0).toString(36)}`;
}

/** 動くスクリプト（構造化データ application/ld+json などのデータ以外）を含む HTML か */
export const RUNNABLE_SCRIPT = /<script\b(?![^>]*\btype\s*=\s*["']?application\/(?:ld\+)?json)/i;

/**
 * ページ専用のコード（計測タグなど）。サーバーの HTML から表示したときは、ブラウザが読み込みながら
 * 中の <script> を動かす。ページの遷移（Link）で表示したときは innerHTML のスクリプトが動かないため、作り直して動かす
 */
export const PAGE_HTML_COMPONENT = `"use client";

import { useEffect, useRef } from "react";

type ScriptRun = { html: string; cancelled: boolean };

export default function PageHtml({ html, staticHtml }: { html: string; staticHtml: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef<ScriptRun | null>(null);

  useEffect(() => {
    const box = ref.current;
    if (!box) return;

    // StrictMode replays mount effects. Do not run inline scripts twice or
    // abandon the rest of a sequence waiting for an external script to load.
    if (active.current?.html === html) {
      const run = active.current;
      run.cancelled = false;
      return () => { run.cancelled = true; };
    }
    const run: ScriptRun = { html, cancelled: false };
    active.current = run;

    // React may keep the same inert markup across two page variants. Reset
    // only our own raw HTML subtree before activating this variant's scripts.
    box.innerHTML = staticHtml;
    void (async () => {
      for (const old of Array.from(box.querySelectorAll<HTMLScriptElement>("script[data-tsumu-deferred]"))) {
        if (run.cancelled) return;
        const script = document.createElement("script");
        for (const attr of Array.from(old.attributes)) {
          if (attr.name === "type" || attr.name === "data-tsumu-deferred" ||
              attr.name === "data-tsumu-original-type") continue;
          script.setAttribute(attr.name, attr.value);
        }
        const originalType = old.getAttribute("data-tsumu-original-type");
        if (originalType !== null) script.setAttribute("type", originalType);
        script.text = old.text;
        // Execute scripts in source order, including external dependencies.
        const loaded = script.src
          ? new Promise<void>((done) => {
              script.onload = script.onerror = () => done();
            })
          : null;
        old.replaceWith(script);
        if (loaded) await loaded;
      }
    })();
    return () => { run.cancelled = true; };
  }, [html, staticHtml]);

  // Both SSR and the first client render are inert. Browser scripts only
  // become executable in the effect, after React has hydrated this subtree.
  return <div ref={ref} style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: staticHtml }} />;
}
`;

/** 検索フォーム: ページ全体を読み込み直さずに、URL の検索パラメーターだけを更新する */
export const SEARCH_FORM_COMPONENT = `"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ComponentPropsWithoutRef, type RefObject, Suspense, useEffect, useRef } from "react";

/** フォームの項目の名前（送信するときのクエリの名前） */
function fieldNames(form: HTMLFormElement): string[] {
  return Array.from(form.elements)
    .map((el) => (el as HTMLInputElement).name)
    .filter(Boolean);
}

// URLを読む部分だけを Suspense に入れ、静的なページでもフォーム本体は配信時に描く。
function RestoreFields({ formRef }: { formRef: RefObject<HTMLFormElement | null> }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  // ソフトナビゲーション・戻る/進むの後、新しいフォームの内容へURLの値を復元する。
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const params = new URLSearchParams(search);
    // 送信した後か（ページ自身のクエリ ?tab=… だけなら、最初の状態のまま）
    const hasQuery = fieldNames(form).some((name) => params.has(name));
    for (const el of Array.from(form.elements)) {
      const input = el as HTMLInputElement;
      // ファイルの欄は値を入れられない（空以外を入れると例外になる）
      if (!input.name || input.type === "file") continue;
      const values = params.getAll(input.name);
      const v = values[0] ?? null;
      if (el instanceof HTMLSelectElement) {
        // select には defaultValue が無い。URLの値の選択肢が無ければ最初に選んでいたものに戻す
        const options = Array.from(el.options);
        // 複数選択は同名のクエリをすべて復元し、以前の選択も解除する。
        if (el.multiple) {
          for (const option of options)
            option.selected = hasQuery ? values.includes(option.value) : option.defaultSelected;
          continue;
        }
        const pick =
          (v === null ? undefined : options.find((o) => o.value === v)) ??
          options.find((o) => o.defaultSelected) ??
          options[0];
        if (pick) pick.selected = true;
      } else if (input.type === "checkbox" || input.type === "radio") {
        input.checked = hasQuery
          ? (input.type === "radio" ? input.value === v : values.includes(input.value))
          : input.defaultChecked;
      } else {
        input.value = v ?? input.defaultValue;
      }
    }
    // スクリプトの「値が変わったとき」へ復元した値を伝える
    form.dispatchEvent(new Event("input", { bubbles: true }));
  }, [formRef, pathname, search]);
  return null;
}

export default function SearchForm({
  children,
  ...rest
}: ComponentPropsWithoutRef<"form">) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={ref}
      {...rest}
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        // フォームの項目は送る値に置き換え、ページ自身のクエリ（?tab=… で分けたページ）は残す
        const qs = new URLSearchParams(window.location.search);
        for (const name of fieldNames(event.currentTarget)) qs.delete(name);
        for (const [k, v] of data.entries()) {
          if (typeof v === "string") qs.append(k, v);
        }
        // ソフトナビゲーション: サーバー再取得で一覧だけが更新される
        router.replace(
          qs.toString() ? \`?\${qs.toString()}\` : window.location.pathname,
          { scroll: false }
        );
      }}
    >
      {children}
      <Suspense fallback={null}><RestoreFields formRef={ref} /></Suspense>
    </form>
  );
}
`;

/** 書き出したプロジェクトの README（ホスティングの選び方と手順） */
export function generatedReadme(siteName: string, cloudflare: boolean): string {
  // 日本語以外の言語では、英語の README にする
  if (getLang() !== "ja") {
    return `# ${siteName}

A Next.js project exported from [Tsumu](https://github.com/abshrimp/tsumu), an open-source visual website builder.
It is a regular Next.js app with no
editor runtime, so you can host it anywhere Next.js runs.

## Develop

\`\`\`bash
npm install
npm run dev
\`\`\`

## Hosting

| Host | How | Notes |
|---|---|---|
| Vercel | Import this repository | Zero config. Every branch other than production gets a preview URL |
| Netlify | Import this repository | Enable branch deploys for preview builds |
| Node.js | \`npm run build && npm start\` | Any server or container |
| Cloudflare Workers | Workers Builds (below) or \`npm run deploy\` | Runs through OpenNext |

${cloudflare ? "This project was exported for **Cloudflare Workers**: pages that fetch JSON are rendered on every request and the JSON is cached at Cloudflare's edge for the refresh interval." : "Pages that fetch JSON use **ISR** (they are rebuilt in the background at the refresh interval). On Cloudflare Workers ISR needs extra setup (an R2 incremental cache and a queue), so choose \"Cloudflare Workers\" as the hosting in the editor's site settings if you deploy there."}

### Cloudflare Workers Builds

Connect this repository in the Cloudflare dashboard (Workers & Pages → Create) and set:

- Build command: \`npx opennextjs-cloudflare build\`
- Deploy command: \`npx opennextjs-cloudflare deploy\`
- Non-production branch deploy command: \`npx opennextjs-cloudflare upload\` (gives the preview branch its own preview URL)

From then on, every publish from the editor (a push to this repository) is built and deployed automatically.

## Editing this repository

Publishing from the editor rewrites the files it generates (listed in \`_tsumu/generated.json\`).

- If you edit a generated file on GitHub, the editor asks before the next publish and then replaces it with the editor's version (the previous content stays in the Git history).
- Files you add yourself under names the editor doesn't generate are kept when you publish.
`;
  }
  return `# ${siteName}

オープンソースのビジュアルWebサイトビルダー [Tsumu](https://github.com/abshrimp/tsumu) から書き出された Next.js プロジェクトです。
エディタに依存しない普通の Next.js アプリなので、Next.js が動く場所ならどこでも公開できます。

## 開発

\`\`\`bash
npm install
npm run dev
\`\`\`

## 公開先

| 公開先 | 方法 | 備考 |
|---|---|---|
| Vercel | このリポジトリをインポート | 設定不要。本番以外のブランチにはプレビューURLが付きます |
| Netlify | このリポジトリをインポート | プレビューにはブランチデプロイを有効にします |
| Node.js | \`npm run build && npm start\` | 任意のサーバー・コンテナ |
| Cloudflare Workers | 下の Workers Builds か \`npm run deploy\` | OpenNext 経由で動きます |

${cloudflare ? "このプロジェクトは **Cloudflare Workers 向け** に書き出しています。JSONを取得するページはアクセスのたびに描画し、取得したJSONを更新間隔のあいだ Cloudflare のキャッシュに置きます。" : "JSONを取得するページは **ISR**（更新間隔ごとに裏でページを作り直す）で配信します。Cloudflare Workers で ISR を動かすには追加の設定（R2 のキャッシュとキュー）が要るため、Cloudflare で公開するときはエディタのサイト設定で公開先を「Cloudflare Workers」にしてください。"}

### Cloudflare Workers Builds

Cloudflare ダッシュボード → Workers & Pages → Create でこのリポジトリを接続し、次のように設定します。

- Build command: \`npx opennextjs-cloudflare build\`
- Deploy command: \`npx opennextjs-cloudflare deploy\`
- Non-production branch deploy command: \`npx opennextjs-cloudflare upload\`（プレビュー用ブランチにプレビューURLが付きます）

以後、エディタの「公開」（= このリポジトリへの push）のたびに自動でビルド・公開されます。

## このリポジトリでの編集

エディタの「公開」は、エディタが書き出すファイル（一覧は \`_tsumu/generated.json\`）をエディタの内容で書き換えます。

- 書き出したファイルを GitHub 上で直接編集した場合は、次の公開の前に確認が出て、エディタの内容で上書きされます（上書き前の内容は Git の履歴に残ります）。
- エディタが書き出さない名前で手で追加したファイルは、公開してもそのまま残ります。
`;
}
