import DOMPurify from "dompurify";

/** Inline icons are rendered as HTML in generated sites, so sanitise them at the import boundary. */
let purifier: ReturnType<typeof DOMPurify> | undefined;

export function sanitizeImportedSvg(svg: string): string {
  if (typeof window === "undefined") throw new Error("SVG import requires browser sanitization.");
  purifier ??= DOMPurify(window);
  const cleaned = purifier.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject", "script"],
  });
  // A safe editable doc.json must round-trip byte-for-byte. DOMPurify may
  // reserialize harmless SVG (e.g. self-closing tags) without changing its DOM.
  // Keep authored bytes only when both parsed SVG trees are identical.
  const normalised = (input: string): string | null => {
    const parsed = new DOMParser().parseFromString(input, "image/svg+xml");
    return parsed.querySelector("parsererror") ? null : parsed.documentElement.outerHTML;
  };
  const originalTree = normalised(svg);
  return originalTree !== null && originalTree === normalised(cleaned) ? svg : cleaned;
}
