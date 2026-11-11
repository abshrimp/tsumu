const ZIP_MIME: Record<string, string> = {
  css: "text/css", js: "text/javascript", mjs: "text/javascript",
  json: "application/json", svg: "image/svg+xml", png: "image/png",
  jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", ico: "image/x-icon", mp4: "video/mp4", webm: "video/webm",
  mp3: "audio/mpeg", wav: "audio/wav", woff: "font/woff", woff2: "font/woff2",
  ttf: "font/ttf", otf: "font/otf", pdf: "application/pdf",
};

export function zipMime(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return Object.hasOwn(ZIP_MIME, extension) ? ZIP_MIME[extension] : "application/octet-stream";
}
