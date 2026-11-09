import type { GeneratedProject } from "../generator";

/**
 * A generated ZIP cannot faithfully represent a file and a directory at
 * the same path. Additionally, user-controlled page slugs and imported
 * assets must never create absolute, traversing, or Windows-ambiguous paths.
 */
export function assertGeneratedPaths(project: GeneratedProject): void {
  const paths = new Set<string>();
  for (const [kind, records] of [
    ["text", project.files],
    ["binary", project.binaries],
    ["remote", project.remoteAssets],
  ] as const) {
    for (const path of Object.keys(records)) {
      const segments = path.split("/");
      if (!path || path.startsWith("/") || /^[a-z]:/i.test(path) ||
          /[\\\u0000-\u001f\u007f]/.test(path) ||
          segments.some((segment) => !segment || segment === "." || segment === "..")) {
        throw new Error("Unsafe generated " + kind + " path: " + path);
      }
      if (paths.has(path)) throw new Error("Duplicate generated file path: " + path);
      paths.add(path);
    }
  }
  for (const path of paths) {
    const segments = path.split("/");
    for (let i = 1; i < segments.length; i++) {
      const parent = segments.slice(0, i).join("/");
      if (paths.has(parent)) {
        throw new Error("Generated file/directory collision: " + parent + " and " + path);
      }
    }
  }
}
