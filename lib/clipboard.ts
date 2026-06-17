import { tr } from "./i18n";
/** Figma / Illustratorなどから渡されたSVGを安全な画像として扱える形にする。 */
export function sanitizeClipboardSvg(source: string): string {
  const start = source.search(/<svg\b/i);
  const end = source.toLowerCase().lastIndexOf("</svg>");
  if (start < 0 || end < start) throw new Error(tr("SVGデータを読み取れませんでした"));

  const raw = source.slice(start, end + 6);
  const parsed = new DOMParser().parseFromString(raw, "image/svg+xml");
  if (parsed.querySelector("parsererror")) {
    throw new Error(tr("SVGデータが壊れています"));
  }
  const svg = parsed.documentElement;
  if (svg.tagName.toLowerCase() !== "svg") throw new Error(tr("SVGではありません"));

  const blockedTags = new Set([
    "script", "foreignobject", "iframe", "object", "embed", "applet",
    "meta", "link", "base", "set", "animate", "animatemotion", "animatetransform",
    "handler", "listener",
  ]);
  for (const element of Array.from(parsed.querySelectorAll("*"))) {
    if (blockedTags.has(element.localName.toLowerCase())) {
      element.remove();
    }
  }

  const safeCss = (css: string) =>
    css
      .replace(/@import[^;]+;?/gi, "")
      .replace(/expression\s*\([^)]*\)/gi, "")
      .replace(/url\(([^)]+)\)/gi, (match, target: string) => {
        const value = target.trim().replace(/^['"]|['"]$/g, "");
        return value.startsWith("#") ? match : "none";
      });

  const safeDataImage = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp)[;,]/i;
  for (const element of Array.from(parsed.querySelectorAll("*"))) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      const compact = value.replace(/[\u0000-\u0020]+/g, "");
      if (name.startsWith("on")) {
        element.removeAttribute(attr.name);
      } else if (name === "style") {
        element.setAttribute(attr.name, safeCss(value));
      } else if (name === "href" || name === "xlink:href" || name === "src") {
        if (!value.startsWith("#") && !safeDataImage.test(value)) {
          element.removeAttribute(attr.name);
        }
      } else if (/(?:javascript|vbscript|data):/i.test(compact)) {
        element.removeAttribute(attr.name);
      }
    }
  }
  parsed.querySelectorAll("style").forEach((style) => {
    style.textContent = safeCss(style.textContent ?? "");
  });

  if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(svg);
}

function svgText(data: DataTransfer): string | null {
  const candidates = [
    data.getData("image/svg+xml"),
    data.getData("text/plain"),
    data.getData("text/html"),
  ];
  return candidates.find((value) => /<svg\b/i.test(value)) ?? null;
}

export function hasClipboardArtwork(data: DataTransfer): boolean {
  if (Array.from(data.items).some((item) => item.kind === "file" && item.type.startsWith("image/"))) {
    return true;
  }
  if (svgText(data)) return true;
  const html = data.getData("text/html");
  const plain = data.getData("text/plain");
  return /<img\b[^>]*src=["']data:image\//i.test(html) || /^data:image\//i.test(plain.trim());
}

async function dataUrlFile(dataUrl: string): Promise<File> {
  const blob = await fetch(dataUrl).then((response) => response.blob());
  const ext = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return new File([blob], `pasted-artwork.${ext}`, { type: blob.type });
}

/** クリップボードから、アップロード可能な安全な画像ファイルを1件取り出す。 */
export async function clipboardArtworkFile(data: DataTransfer): Promise<File | null> {
  const svg = svgText(data);
  if (svg) {
    const clean = sanitizeClipboardSvg(svg);
    return new File([clean], "pasted-artwork.svg", { type: "image/svg+xml" });
  }

  const files = Array.from(data.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file);
  const file = files.find((item) => item.type === "image/svg+xml") ?? files[0];
  if (file?.type === "image/svg+xml") {
    const clean = sanitizeClipboardSvg(await file.text());
    return new File([clean], file.name || "pasted-artwork.svg", {
      type: "image/svg+xml",
    });
  }
  if (file) return file;

  const html = data.getData("text/html");
  const match = /<img\b[^>]*src=["'](data:image\/[^"']+)["']/i.exec(html);
  if (match) return dataUrlFile(match[1]);
  const plain = data.getData("text/plain").trim();
  if (/^data:image\//i.test(plain)) return dataUrlFile(plain);
  return null;
}
