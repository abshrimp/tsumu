import axes from "./google-font-axes.json";
import type { CustomFont } from "./types";

// Generated from the installed next/font catalog by scripts/sync-google-font-axes.mjs.
let byFamily: Map<string, string> | undefined;

export function googleFontWeightAxis(family: string): string | undefined {
  byFamily ??= new Map(Object.entries(axes).flatMap(([range, families]) =>
    families.split("|").map(name => [name.toLowerCase(), range] as const)));
  return byFamily.get(family.toLowerCase());
}

/** Shared by the editor stylesheet and CSS2-based exports. */
export function css2FamilyToken(font: CustomFont): string {
  const name = "family=" + encodeURIComponent(font.family).replace(/%20/g, "+");
  if (font.weights === "variable") {
    const axis = googleFontWeightAxis(font.family);
    // Older documents can identify a variable font outside the bundled catalog.
    return name + ":wght@" + (axis ?? "100..900");
  }
  const weights = [...new Set(font.weights.filter(weight => /^(?:[1-9]\d{0,2}|1000)$/.test(weight)))]
    .sort((a, b) => Number(a) - Number(b));
  return !weights.length || (weights.length === 1 && weights[0] === "400")
    ? name : name + ":wght@" + weights.join(";");
}
