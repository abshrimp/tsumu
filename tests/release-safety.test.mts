import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const userGuide = readFileSync(new URL("../docs/user-guide.md", import.meta.url), "utf8");
const backupScript = [...userGuide.matchAll(/```bash\n([\s\S]*?)```/g)]
  .map((match) => match[1]).find((script) => script.includes("docker stop tsumu"));
assert.ok(backupScript, "user guide must provide the Docker backup procedure");
const runbook = readFileSync(new URL("../docs/releasing.md", import.meta.url), "utf8");
const integrityScript = runbook.match(/<!-- restore-integrity-check -->\n```sh\n([\s\S]*?)```/)?.[1];
assert.ok(integrityScript, "runbook must provide the disposable restore check");

// 文書に書いた実際のシェルのブロックを実行するが、Docker のデーモンには決して接続しない。
// 通常の対話的なシェルは、文書から `set -e` を引き継がない。
function dockerBackup(scenario: string, check: (result: ReturnType<typeof spawnSync>, calls: string[][]) => void) {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-release-"));
  try {
    const log = join(dir, "docker-calls.jsonl");
    writeFileSync(join(dir, "docker"), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_DOCKER_LOG, JSON.stringify(args) + '\\n');
const scenario = process.env.TEST_DOCKER_SCENARIO;
if (args[0] === 'stop' && scenario === 'stop-failure') process.exit(41);
if (args[0] === 'run' && scenario === 'archive-failure') process.exit(42);
if (args[0] === 'inspect') {
  if (scenario === 'inspect-failure') process.exit(43);
  if (args.join(' ').includes('.Mounts')) {
    console.log(scenario === 'wrong-volume' ? 'different-data' : 'tsumu-data');
    if (scenario === 'volume-inspect-output-failure') process.exit(43);
  } else {
    console.log(scenario === 'still-running' ? 'true' : 'false');
    if (scenario === 'state-inspect-output-failure') process.exit(43);
  }
}
`, { mode: 0o755 });
    const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", backupScript!], {
      cwd: dir,
      env: {
        PATH: `${dir}:/usr/bin:/bin`, HOME: dir,
        TEST_DOCKER_LOG: log, TEST_DOCKER_SCENARIO: scenario,
      },
      encoding: "utf8",
    });
    assert.ifError(result.error);
    const calls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
    check(result, calls);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const scenario of ["stop-failure", "inspect-failure", "still-running", "wrong-volume",
  "volume-inspect-output-failure", "state-inspect-output-failure"]) {
  test(`documented Docker backup refuses to copy when ${scenario}`, () => {
    dockerBackup(scenario, (result, calls) => {
      assert.notEqual(result.status, 0, "an unsafe backup attempt must report failure");
      assert.ok(!calls.some((args) => args[0] === "run"), "must not archive an unverified volume or live writer");
      assert.ok(!calls.some((args) => args[0] === "start"), "must not continue after a failed precondition");
    });
  });
}

test("documented Docker backup preserves archive failures instead of masking them with restart success", () => {
  dockerBackup("archive-failure", (result, calls) => {
    assert.notEqual(result.status, 0);
    assert.ok(calls.some((args) => args[0] === "stop"));
    assert.ok(calls.some((args) => args[0] === "run"));
    assert.ok(!calls.some((args) => args[0] === "start"));
  });
});

test("documented Docker backup reads the stopped volume without overwriting the previous archive", () => {
  dockerBackup("success", (result, calls) => {
    assert.equal(result.status, 0, String(result.stderr));
    const stop = calls.findIndex((args) => args[0] === "stop");
    const run = calls.findIndex((args) => args[0] === "run");
    const start = calls.findIndex((args) => args[0] === "start");
    assert.ok(stop >= 0 && stop < run && run < start);
    assert.ok(calls[run].includes("type=volume,src=tsumu-data,dst=/data,readonly"));
    const output = calls[run].find((arg) => arg.startsWith("type=bind,src="));
    assert.ok(output?.match(/\/tsumu-backup\.[^/]+,dst=\/backup$/), "each attempt needs its own output directory");
    assert.ok(calls[run].at(-1)?.includes("test -s /data/tsumu.db"), "an empty volume is not a backup");
    assert.ok(calls[run].at(-1)?.includes("tar tzf"), "verify archive readability before restarting");
  });
});

function checkIntegrity(dir: string, restoreDir?: string) {
  return spawnSync("/bin/sh", ["-c", integrityScript!], {
    cwd: dir,
    env: {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      ...(restoreDir === undefined ? {} : { TSUMU_RESTORE_DIR: restoreDir }),
    },
    encoding: "utf8",
  });
}

for (const scenario of ["unset", "missing", "corrupt"]) {
  test(`documented restore check rejects ${scenario} input without creating or replacing data`, () => {
    const dir = mkdtempSync(join(tmpdir(), "tsumu-restore-"));
    const file = join(dir, "tsumu.db");
    const corrupt = "This is not a SQLite database";
    try {
      if (scenario === "corrupt") writeFileSync(file, corrupt);
      const result = checkIntegrity(dir, scenario === "unset" ? undefined : dir);
      assert.ifError(result.error);
      assert.notEqual(result.status, 0, result.stdout);
      assert.doesNotMatch(result.stdout, /SQLite integrity: ok/);
      if (scenario === "corrupt") assert.equal(readFileSync(file, "utf8"), corrupt);
      else assert.equal(existsSync(file), false, "must not create a new empty database");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("documented archive and restore check preserve a stopped SQLite fixture and asset metadata", () => {
  // Docker の操作は上で模擬した。ここでは、その実際のアーカイブの中身を、ホストの tar と
  // 使い捨てのパスで実行し、展開は新しいディレクトリの中だけで行う。
  let payload = "";
  dockerBackup("success", (result, calls) => {
    assert.equal(result.status, 0);
    payload = calls.find((args) => args[0] === "run")!.at(-1)!;
  });
  const dir = mkdtempSync(join(tmpdir(), "tsumu-roundtrip-"));
  try {
    const source = join(dir, "stopped data");
    const output = join(dir, "backup");
    const restored = join(dir, "restored");
    for (const path of [join(source, "assets/data"), join(source, "assets/meta"), output, restored]) {
      mkdirSync(path, { recursive: true });
    }
    const db = new DatabaseSync(join(source, "tsumu.db"));
    try {
      db.exec("PRAGMA journal_mode = WAL; CREATE TABLE docs (id TEXT PRIMARY KEY, rev INTEGER, body TEXT)");
      db.prepare("INSERT INTO docs VALUES (?, ?, ?)").run("fixture", 7, '{"siteName":"Release fixture"}');
    } finally {
      db.close(); // 文書に書いたコピーの前に、準備で書き込むものをすべて止める。
    }
    writeFileSync(join(source, "assets/data/fixture.svg"), "<svg/>");
    writeFileSync(join(source, "assets/meta/fixture.svg"), '{"contentType":"image/svg+xml"}');
    const localPayload = payload.replaceAll("/data/", '"$TEST_DATA"/')
      .replaceAll("-C /data .", '-C "$TEST_DATA" .')
      .replaceAll("/backup/", '"$TEST_BACKUP"/');
    const result = spawnSync("/bin/sh", ["-ec", localPayload], {
      env: { PATH: "/usr/bin:/bin", TEST_DATA: source, TEST_BACKUP: output }, encoding: "utf8",
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    execFileSync("/usr/bin/tar", ["xzf", join(output, "tsumu-data.tgz"), "-C", restored]);
    for (const file of ["tsumu.db", "assets/data/fixture.svg", "assets/meta/fixture.svg"]) {
      assert.deepEqual(readFileSync(join(restored, file)), readFileSync(join(source, file)));
    }
    const before = readFileSync(join(restored, "tsumu.db"));
    const integrity = checkIntegrity(dir, restored);
    assert.ifError(integrity.error);
    assert.equal(integrity.status, 0, integrity.stderr);
    assert.match(integrity.stdout, /SQLite integrity: ok; application and asset checks still required/);
    assert.deepEqual(readFileSync(join(restored, "tsumu.db")), before, "validation must not change database bytes");
    const recovered = new DatabaseSync(join(restored, "tsumu.db"), { readOnly: true });
    try {
      assert.deepEqual({ ...recovered.prepare("SELECT * FROM docs").get() }, {
        id: "fixture", rev: 7, body: '{"siteName":"Release fixture"}',
      });
    } finally {
      recovered.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
