import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";

const framework = process.argv[2];
if (!["nuxt", "sveltekit"].includes(framework)) process.exit(0);
const cwd = resolve(".generated-export-smoke");
const command = framework === "nuxt" ? ".output/server/index.mjs" : "build/index.js";
const port = framework === "nuxt" ? "48731" : "48732";
const child = spawn(process.execPath, [command], {
  cwd,
  env: { ...process.env, HOST: "127.0.0.1", PORT: port, NITRO_PORT: port, NITRO_HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout?.on("data", (chunk) => { logs += chunk.toString(); });
child.stderr?.on("data", (chunk) => { logs += chunk.toString(); });
try {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 75; attempt++) {
    if (child.exitCode !== null) throw new Error("SSR server exited:\n" + logs);
    try {
      response = await fetch("http://127.0.0.1:" + port + "/");
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!response?.ok) throw new Error("SSR server did not start. Logs:\n" + logs);
  const html = await response.text();
  if (!/<h1[^>]*>\s*Smoke test\s*<\/h1>/i.test(html)) {
    throw new Error("SSR did not render the heading in the HTTP response:\n" + html.slice(0, 3000));
  }
  console.log(framework + " SSR HTTP response rendered the native heading");
} finally {
  child.kill("SIGTERM");
  if (child.exitCode === null) {
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
