import source from "./vendor/picomatch.json";

const packageFiles = Object.fromEntries(Object.entries(source).map(([path, lines]) =>
  ["vendor/picomatch/" + path, lines.join("\n")]));

/** Ship the reviewed glob parser with each independently installable project. */
export function addPatchedPicomatch(files: Record<string, string>): void {
  const pkg = JSON.parse(files["package.json"]) as {
    engines?: Record<string, string>;
    packageManager?: string;
    devDependencies?: Record<string, string>;
    overrides?: Record<string, unknown>;
  };
  pkg.engines = { ...pkg.engines, node: ">=26.12.1", npm: ">=12.2.1" };
  pkg.packageManager = "npm@12.2.1";
  pkg.devDependencies = { ...pkg.devDependencies, picomatch: "file:vendor/picomatch" };
  // Referencing the direct dependency also satisfies consumers' optional peers.
  pkg.overrides = { ...pkg.overrides, picomatch: "$picomatch" };
  files["package.json"] = JSON.stringify(pkg, null, 2) + "\n";
  files[".nvmrc"] = "26.12.1\n";
  Object.assign(files, packageFiles);
}
