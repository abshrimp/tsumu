import { tr } from "./i18n";
import DOMPurify from "dompurify";
/** Figma / Illustratorなどから渡されたSVGを安全な画像として扱える形にする。 */
export function sanitizeClipboardSvg(source: string): string {
  // Reject XML entity declarations before parsing and bound oversized paste payloads.
  if (source.length > 2 * 1024 * 1024 || /<!\s*(?:doctype|entity)\b/i.test(source)) {
    throw new Error(tr("The SVG data is corrupted"));
  }
  const start = source.search(/<svg\b/i);
  const end = source.toLowerCase().lastIndexOf("</svg>");
  if (start < 0 || end < start) throw new Error(tr("Couldn't read the SVG data"));

  const raw = source.slice(start, end + 6);
  // DOMPurify sanitizes unsafe SVG markup before we apply the editor's stricter
  // attribute and CSS policy. Avoid parsing untrusted XML with DOMParser.
  const cleaned = DOMPurify.sanitize(raw, {
    RETURN_DOM: true,
    USE_PROFILES: { svg: true, svgFilters: true },
    // Figma can place artwork in <defs> and render it with <use href="#...">.
    // DOMPurify omits <use> by default; enforce fragment-only references below.
    ADD_TAGS: ["use"],
    FORBID_TAGS: [
      "script", "foreignObject", "iframe", "object", "embed", "applet",
      "meta", "link", "base", "set", "animate", "animateMotion", "animateTransform",
      "handler", "listener",
    ],
  });
  const root = cleaned instanceof Element ? cleaned : null;
  const svg = root?.localName === "svg" ? root : root?.querySelector("svg");
  if (!svg) throw new Error(tr("Not an SVG"));

  const blockedTags = new Set([
    "script", "foreignobject", "iframe", "object", "embed", "applet",
    "meta", "link", "base", "set", "animate", "animatemotion", "animatetransform",
    "handler", "listener",
  ]);
  for (const element of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
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
  for (const element of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
    const isUse = element.localName.toLowerCase() === "use";
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      const compact = value.replace(/[\u0000-\u0020]+/g, "");
      if (name.startsWith("on")) {
        element.removeAttribute(attr.name);
      } else if (name === "style") {
        element.setAttribute(attr.name, safeCss(value));
      } else if (name === "href" || name === "xlink:href" || name === "src") {
        // <use> must never load another SVG document, even a data: image.
        // Only references to IDs inside this sanitized SVG are permitted.
        if (isUse ? !/^#[A-Za-z0-9_.:-]+$/.test(value)
          : !value.startsWith("#") && !safeDataImage.test(value)) {
          element.removeAttribute(attr.name);
        }
      } else if (/(?:javascript|vbscript|data):/i.test(compact)) {
        element.removeAttribute(attr.name);
      }
    }
    // A <use> with no local target renders nothing and need not survive.
    if (isUse && !element.getAttribute("href") && !element.getAttribute("xlink:href")) {
      element.remove();
    }
  }
  svg.querySelectorAll("style").forEach((style) => {
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

function dataUrlFile(dataUrl: string): File {
  // Clipboard images are local bytes, not network URLs. Decode only bounded
  // base64 image data rather than passing arbitrary clipboard input to fetch().
  const match = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(dataUrl);
  if (!match || match[2].length > 24 * 1024 * 1024) {
    throw new Error(tr("Couldn't read the SVG data"));
  }
  const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
  const mime = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  const ext = mime === "jpeg" ? "jpg" : mime;
  return new File([bytes], `pasted-artwork.${ext}`, { type: `image/${mime}` });
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
