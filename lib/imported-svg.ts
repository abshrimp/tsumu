import DOMPurify from "dompurify";

/** Inline icons are rendered as HTML in generated sites, so sanitise them at the import boundary. */
let purifier: ReturnType<typeof DOMPurify> | undefined;

export function sanitizeImportedSvg(svg: string): string {
  if (typeof window === "undefined") throw new Error("SVG import requires browser sanitization.");
  purifier ??= DOMPurify(window);
  return purifier.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject", "script"],
  });
}
