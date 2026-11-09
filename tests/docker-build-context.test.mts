import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);

// Requires Docker with BuildKit. Run explicitly with:
// TSUMU_DOCKER_TESTS=1 node --import tsx --test tests/docker-build-context.test.mts
// Export a scratch image so Docker itself evaluates .dockerignore; no base image,
// application credentials, running containers or deployment changes are needed.
test("Docker COPY excludes persistent data at every depth while retaining build inputs", {
  skip: process.env.TSUMU_DOCKER_TESTS !== "1" && "Set TSUMU_DOCKER_TESTS=1 to run the Docker context regression",
  timeout: 120_000,
}, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "tsumu-docker-context-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const context = join(temporary, "context");
  const output = join(temporary, "output");
  const write = async (path: string, content = "synthetic test data") => {
    const destination = join(context, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  };
  await write("Dockerfile", "FROM scratch\nCOPY . /context/\n");
  await write(".dockerignore", await readFile(new URL("../.dockerignore", import.meta.url), "utf8"));

  const persisted = [
    "tsumu.db", "tsumu.db-wal", "tsumu.db-shm",
    "snapshot.sqlite", "snapshot.sqlite3", "export.sql", "tsumu-data-2026.tgz",
    // Asset payloads and metadata have no database extension; exclude the store.
    "data/assets/data/upload", "data/assets/meta/upload", "data/tsumu.db",
    ".e2e-data/assets/data/upload", ".e2e-data/tsumu.db",
  ];
  const excluded = ["", "backups/", "backups/local/"].flatMap((prefix) =>
    persisted.map((path) => prefix + path));
  // Positive controls catch accidental broad exclusions of source and assets.
  const included = [
    "package.json", "package-lock.json", "next.config.mjs",
    "app/page.tsx", "lib/node-storage.ts", "lib/data.ts",
    "docs/screenshots/en/editor.png", "tests/node-storage.test.mts",
    "backups/README.md", "backups/local/README.md",
  ];
  for (const path of [...excluded, ...included]) await write(path);

  await exec("docker", ["buildx", "build", "--progress=plain",
    "--output", `type=local,dest=${output}`, context], {
    timeout: 90_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const copied = join(output, "context");
  const files: string[] = [];
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push(relative(copied, path).split("\\").join("/"));
    }
  };
  await walk(copied);
  for (const path of excluded) {
    assert.ok(!files.includes(path), `Persistent data entered the Docker build: ${path}`);
  }
  for (const path of included) {
    assert.ok(files.includes(path), `Build input was incorrectly excluded: ${path}`);
    assert.equal(await readFile(join(copied, path), "utf8"), "synthetic test data");
  }
});
