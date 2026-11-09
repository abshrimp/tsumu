import type { GeneratedProject } from "../generator";

/**
 * Ensure every export is extractable on case-insensitive Windows/macOS filesystems.
 * No generated path may escape the output root or turn a file into a directory.
 */
export function assertGeneratedPaths(project: GeneratedProject): void {
  const paths = new Set<string>();
  const portablePaths = new Map<string, string>();
  const normalize = (path: string) => path.normalize("NFC").toLowerCase();
  for (const [kind, records] of [
    ["text", project.files],
    ["binary", project.binaries],
    ["remote", project.remoteAssets],
  ] as const) {
    for (const path of Object.keys(records)) {
      const segments = path.split("/");
      if (!path || path.startsWith("/") || /^[a-z]:/i.test(path) ||
          /[\\\u0000-\u001f\u007f<>:"|?*]/.test(path) ||
          segments.some((segment) => !segment || segment === "." || segment === ".." ||
            /[. ]$/.test(segment) ||
            /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment))) {
        throw new Error("Unsafe generated " + kind + " path: " + path);
      }
      if (paths.has(path)) throw new Error("Duplicate generated file path: " + path);
      const canonical = normalize(path);
      const existing = portablePaths.get(canonical);
      if (existing) {
        throw new Error("Case-insensitive generated file collision: " + existing + " and " + path);
      }
      paths.add(path);
      portablePaths.set(canonical, path);
    }
  }
  for (const path of paths) {
    const segments = path.split("/");
    for (let i = 1; i < segments.length; i++) {
      const parent = segments.slice(0, i).join("/");
      const existing = portablePaths.get(normalize(parent));
      if (existing) {
        throw new Error("Generated file/directory collision: " + existing + " and " + path);
      }
    }
  }
}
