import type { Asset } from "./types";

export type AssetDisplayKind =
  | "image" | "video" | "audio"
  | "css" | "javascript" | "font" | "json" | "document" | "archive" | "file";

type DescribedFile = Pick<Asset, "name" | "mimeType">;

/** Classify by MIME first and by extension for existing assets without MIME. */
export function assetDisplayKind(file: DescribedFile): AssetDisplayKind {
  const mime = file.mimeType?.toLowerCase().split(";")[0].trim() ?? "";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "text/css" || ext === "css") return "css";
  if (/(?:javascript|ecmascript)/.test(mime) || ["js", "mjs", "cjs"].includes(ext)) return "javascript";
  if (mime.startsWith("font/") || ["woff", "woff2", "ttf", "otf", "eot"].includes(ext)) return "font";
  if (mime === "application/json" || mime === "application/ld+json" ||
      ["json", "map"].includes(ext)) return "json";
  if (mime === "application/zip" || ["zip", "gz", "tar", "br"].includes(ext)) return "archive";
  if (mime === "application/pdf" || mime.startsWith("text/") ||
      ["pdf", "html", "htm", "md", "txt", "xml", "csv"].includes(ext)) return "document";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "bmp"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(ext)) return "audio";
  return "file";
}

/** Compact label shown on non-image asset thumbnails. */
export function assetExtensionLabel(file: DescribedFile): string {
  const ext = file.name.split(".").pop()?.toUpperCase() ?? "";
  if (ext && /^[A-Z0-9]{1,6}$/.test(ext)) return ext;
  const kind = assetDisplayKind(file);
  if (kind === "javascript") return "JS";
  if (kind === "font") return "FONT";
  if (kind === "document") return "DOC";
  return kind === "file" ? "FILE" : kind.toUpperCase();
}

export function isVisualAsset(file: DescribedFile): boolean {
  return ["image", "video", "audio"].includes(assetDisplayKind(file));
}
