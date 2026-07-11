import type { EmbedContent } from "./types";

/** ユーザー入力から iframe の src を組み立てる。未入力・解釈不能なら null */
export function embedSrc(embed: EmbedContent): string | null {
  const src = embed.src.trim();
  if (!src) return null;

  if (embed.kind === "youtube") {
    const id =
      /(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,})/.exec(
        src
      )?.[1] ?? (/^[\w-]{6,}$/.test(src) ? src : null);
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }

  if (embed.kind === "map") {
    // 共有メニューの埋め込みURL（https://www.google.com/maps/embed?... など）はそのまま使う
    if (isGoogleMapsEmbedUrl(src)) return src;
    // 住所・場所名・通常のマップURLは検索埋め込みに変換
    return `https://www.google.com/maps?q=${encodeURIComponent(src)}&output=embed`;
  }

  // javascript: などの危険なスキームや壊れたURLは埋め込まない
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src) && !/^https?:\/\//i.test(src)) return null;
  const candidate = /^https?:\/\//i.test(src) ? src : `https://${src.replace(/^\/+/, "")}`;
  try {
    const u = new URL(candidate);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Googleマップの共有メニューが発行する埋め込み専用URLか */
function isGoogleMapsEmbedUrl(src: string): boolean {
  try {
    const u = new URL(src);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      /^(?:www\.|maps\.)?google\.(?:com|[a-z]{2,3}(?:\.[a-z]{2})?)$/i.test(u.hostname) &&
      /^\/maps\/embed(?:[/?]|$)/.test(u.pathname)
    );
  } catch {
    return false;
  }
}

/** iframe に付与する許可属性（YouTube用） */
export const YOUTUBE_ALLOW =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
