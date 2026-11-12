import type { EmbedContent } from "./types";

/** 利用者の入力から iframe の src を組み立てる。未入力か、解釈できなければ null を返す */
export function embedSrc(embed: EmbedContent): string | null {
  const src = embed.src.trim();
  if (!src) return null;

  if (embed.kind === "youtube") {
    // v はクエリのキーとして読む。rv などの別のキーやフラグメントに
    // 含まれる「v=」で、指定された動画を上書きしない。
    const watch = /youtube\.com\/watch\?([^#]*)/.exec(src);
    const watchId = watch ? new URLSearchParams(watch[1]).get("v") : null;
    const id =
      watch
        ? (watchId && /^[\w-]{6,}$/.test(watchId) ? watchId : null)
        : /(?:youtube\.com\/(?:shorts\/|embed\/|live\/)|youtube-nocookie\.com\/embed\/|youtu\.be\/)([\w-]{6,})/.exec(
            src
          )?.[1] ?? (/^[\w-]{6,}$/.test(src) ? src : null);
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }

  if (embed.kind === "map") {
    // 共有メニューの埋め込み用の URL（https://www.google.com/maps/embed?... など）は、そのまま使う
    if (isGoogleMapsEmbedUrl(src)) return src;
    // 住所・場所の名前・通常の地図の URL は、検索の埋め込みに変換する
    return `https://www.google.com/maps?q=${encodeURIComponent(src)}&output=embed`;
  }

  // javascript: などの危険なスキームや、壊れた URL は埋め込まない
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

/** Google マップの共有メニューが発行する、埋め込み専用の URL か */
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

/** iframe に付ける許可の属性（YouTube 用） */
export const YOUTUBE_ALLOW =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
