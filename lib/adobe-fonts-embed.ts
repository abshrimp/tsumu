import type { AdobeFont } from "./types";

/**
 * Adobeの埋め込みコードは実行せず、配信元IDとCSSファミリー名だけを抽出する。
 * 貼り付けたコード自体は保存・再出力しない。
 */
export interface AdobeEmbed {
  kitId: string;
  loading: AdobeFont["loading"];
}

const KIT_ID = /^[a-z0-9]{7}$/;
const FAMILY = /^[A-Za-z][A-Za-z0-9 _-]{0,79}$/;

/** CSSのfont-family宣言、またはファミリー名だけの入力を受け付ける。 */
export function adobeCssFamily(source: string): string | null {
  const text = source.trim();
  if (FAMILY.test(text)) return text;
  const found = [...text.matchAll(/\bfont-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^,;\n}\r]+))/gi)];
  if (!found.length) return null;
  const families = [...new Set(found.map((match) => (match[1] ?? match[2] ?? match[3]).trim()))];
  return families.length === 1 && FAMILY.test(families[0]) ? families[0] : null;
}

/**
 * Adobe FontsのWebプロジェクトが出す<script>、<link>、またはCSS @importから
 * 1つのkitだけを読み取る。複数のkitや異なる読み込み方式は混同しない。
 * 日本語向けのinline scriptは kitId と use.typekit.net の組み合わせを検証する。
 */
export function parseAdobeEmbed(source: string): AdobeEmbed | null {
  if (!source || source.length > 30_000) return null;
  const projects: AdobeEmbed[] = [];
  for (const match of source.matchAll(/https:\/\/use\.typekit\.net\/([a-z0-9]{7})\.(css|js)(?![\w.-])/g)) {
    projects.push({ kitId: match[1], loading: match[2] === "js" ? "dynamic" : "css" });
  }
  // Adobeが出力する日本語フォント用の標準スニペットはURLを連結して作る。
  // kitIdを含むだけの無関係なコードを受け付けないため、配信元と拡張子も必須。
  if (/<script\b/i.test(source) && /https:\/\/use\.typekit\.net\//.test(source) &&
      /\+\s*['"]\.js['"]/.test(source)) {
    for (const match of source.matchAll(/\bkitId\s*:\s*(['"])([a-z0-9]{7})\1/g)) {
      projects.push({ kitId: match[2], loading: "dynamic" });
    }
  }
  if (!projects.length || projects.some((p) => !KIT_ID.test(p.kitId))) return null;
  const first = projects[0];
  return projects.every((project) =>
    project.kitId === first.kitId && project.loading === first.loading) ? first : null;
}

/** Read the project ID from a short ID, a hosted CSS/JS URL, or Adobe's supplied snippet. */
export function parseAdobeKitInput(source: string): AdobeEmbed | null {
  const input = source.trim();
  if (/^[a-z0-9]{7}$/.test(input)) return { kitId: input, loading: "css" };
  const url = /^https:\/\/use\.typekit\.net\/([a-z0-9]{7})\.(css|js)(?:\?[^\s<>]*)?$/.exec(input);
  if (url) return { kitId: url[1], loading: url[2] === "js" ? "dynamic" : "css" };
  return parseAdobeEmbed(input);
}
