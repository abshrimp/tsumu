const MEDIA_TYPES: Record<string, string> = {
  apng: "image/apng", avif: "image/avif", bmp: "image/bmp", gif: "image/gif",
  ico: "image/x-icon", jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png",
  svg: "image/svg+xml", webp: "image/webp", mov: "video/quicktime", mp4: "video/mp4",
  webm: "video/webm", aac: "audio/aac", flac: "audio/flac", m4a: "audio/mp4",
  mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", woff: "font/woff",
  woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
};

const ZIP_MIME: Record<string, string> = {
  ...MEDIA_TYPES, css: "text/css", js: "text/javascript", mjs: "text/javascript",
  json: "application/json", pdf: "application/pdf",
};

function lookup(path: string, types: Record<string, string>) {
  const extension = /\.([^.\/]+)$/.exec(path)?.[1].toLowerCase() ?? "";
  return Object.hasOwn(types, extension) ? types[extension] : undefined;
}

export function zipMediaMime(path: string) {
  return lookup(path, MEDIA_TYPES);
}

export function zipMime(path: string): string {
  return lookup(path, ZIP_MIME) ?? "application/octet-stream";
}
