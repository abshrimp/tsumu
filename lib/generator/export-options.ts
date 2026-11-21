export type ExportFormat = "nextjs" | "react" | "html" | "single-html" | "vue" | "nuxt" | "sveltekit";
export const EXPORT_FRAMEWORK_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: "nextjs", label: "Next.js" },
  { value: "react", label: "React + Vite" },
  { value: "vue", label: "Vue 3 + Vite" },
  { value: "nuxt", label: "Nuxt" },
  { value: "sveltekit", label: "SvelteKit" },
  { value: "html", label: "HTML / CSS / JavaScript" },
  { value: "single-html", label: "Single HTML" },
];

export type ExportLanguage = "typescript" | "javascript";
export type ExportStyle = "css" | "css-modules" | "tailwind";
export type ExportScope = "project" | "page" | "component";

export interface ExportOptions {
  framework: ExportFormat;
  language: ExportLanguage;
  style: ExportStyle;
  scope: ExportScope;
  pageId?: string;
  nodeId?: string;
  /** Direct static hosting serves the archive at the origin root and respects every page slug. */
  htmlPlacement?: "site-root";
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  framework: "nextjs",
  language: "typescript",
  style: "css",
  scope: "project",
};

export function resolveExportOptions(options: ExportFormat | ExportOptions): ExportOptions {
  return typeof options === "string"
    ? { ...DEFAULT_EXPORT_OPTIONS, framework: options }
    : options;
}

/** Static HTML can generate an entry page when the author has not defined a root URL. */
export function exportHomeRequirement(framework: ExportFormat, scope: ExportScope): boolean | "if-defined" {
  if (scope !== "project") return false;
  return framework === "html" || framework === "single-html" ? "if-defined" : true;
}
