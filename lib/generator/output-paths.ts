import type { GeneratedProject } from "../generator";

const encoder = new TextEncoder();

export function isPortableOutputPath(path: string): boolean {
  const segments = path.split("/");
  return !/^[a-z]:/i.test(path) &&
    !/[\\\u0000-\u001f\u007f<>:"|?*]/.test(path) &&
    !segments.some((segment) => !segment || segment === "." || segment === ".." ||
      encoder.encode(segment).byteLength > 255 ||
      /[. ]$/.test(segment) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment));
}

/**
 * どの書き出しも、大文字と小文字を区別しない Windows や macOS のファイルシステムに展開できるようにする。
 * 生成したパスが出力のルートの外に出たり、ファイルをディレクトリに変えたりしてはならない。
 */
export function assertGeneratedPaths(project: GeneratedProject, reservedPaths: readonly string[] = []): void {
  const paths = new Set<string>();
  const portablePaths = new Map<string, string>();
  const normalize = (path: string) => path.normalize("NFC").toLowerCase();
  for (const [kind, records] of [
    ["text", project.files],
    ["binary", project.binaries],
    ["remote", project.remoteAssets],
    // ZIP にだけ入る項目も、衝突の検出に含める。
    ["reserved", Object.fromEntries(reservedPaths.map((path) => [path, ""]))],
  ] as const) {
    for (const path of Object.keys(records)) {
      if (!isPortableOutputPath(path)) {
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
