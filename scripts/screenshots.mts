/**
 * README のスクリーンショット（docs/screenshots/<言語>/*.png）を撮り直す。
 * サンプルのサイト・コメント・入力する文は docs/screenshots/sample/<言語>.json にある。
 *
 * 1. 使い捨ての保存先で、公開とAIを仮の値で有効にしてエディタを起動する。
 *    画面を開くだけなので、GitHub や AI のサービスには何も送らない。
 *      npm run build
 *      TSUMU_DATA_DIR=$(mktemp -d) ALLOW_ANONYMOUS=true AI_ENABLED=true \
 *        ANTHROPIC_API_KEY=placeholder GITHUB_TOKEN=placeholder npx next start -p 3000
 * 2. 別の端末で撮影する（初回は npx playwright install chromium）。
 *      node --import tsx scripts/screenshots.mts [--base http://localhost:3000] [--lang ja,en] [--only editor,ai]
 *    Playwright の Chromium の代わりに手元の Chrome を使う場合は CHROME_PATH を指定する。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "@playwright/test";

interface Sample {
  site: { name: string; repo: string };
  comments: { node: string | null; x: number; y: number; body: string; replies?: string[] }[];
  replyDraft: string;
  aiPrompt: string;
  help: { category: string; article: string };
  labels: { editScripts: string };
  doc: { pageOrder: string[]; pages: Record<string, { name: string; children: string[] }>; nodes: Record<string, { name: string; children: string[] }> };
}

const { values } = parseArgs({ options: { base: { type: "string", default: "http://localhost:3000" }, lang: { type: "string", default: "ja,en" }, only: { type: "string" } } });
const base = values.base!;
const root = resolve(import.meta.dirname, "..");
const SHOTS = ["editor", "ai", "publish", "comments", "help", "responsive", "scripts"] as const;

/** サンプルのサイトを新しく作り、コメントを付けてエディタで開く */
async function openSample(page: Page, sample: Sample) {
  const created = await page.request.post(`${base}/api/sites`, { data: { name: sample.site.name, repo: sample.site.repo } });
  if (!created.ok()) throw new Error(`サイトを作れませんでした（${created.status()}）。エディタを起動しているか確認してください`);
  const { site } = await created.json();
  const api = (path: string) => `${base}${path}?site=${site.id}`;
  const current = await (await page.request.get(api("/api/doc"))).json();
  const saved = await page.request.put(`${api("/api/doc")}${current.rev ? `&base=${current.rev}` : ""}`, { data: sample.doc });
  if (!saved.ok()) throw new Error(`サンプルを保存できませんでした（${saved.status()}）`);
  const pageId = sample.doc.pageOrder[0];
  for (const [i, c] of sample.comments.entries()) {
    // コメントのIDはサイトをまたいで一意にする
    const id = `sample_${i}_${site.id}`;
    await page.request.post(api("/api/comments"), { data: { action: "create", id, pageId, nodeId: c.node, x: c.x, y: c.y, bp: "base", body: c.body } });
    for (const [j, body] of (c.replies ?? []).entries()) {
      await page.request.post(api("/api/comments"), { data: { action: "reply", threadId: id, id: `${id}_${j}`, body } });
    }
  }
  await page.goto(`${base}/sites/${site.id}`);
  await page.locator('[data-tutorial="save-status"]').waitFor();
  await page.locator(".cv-root").waitFor();
  await page.waitForTimeout(1000);
}

const tool = (page: Page, name: string) => page.locator(`[data-tutorial="${name}"]`).first();
const headline = (sample: Sample) => {
  const home = sample.doc.pages[sample.doc.pageOrder[0]];
  return sample.doc.nodes[home.children[1]].children[0];
};

const take: Record<(typeof SHOTS)[number], (page: Page, sample: Sample) => Promise<void>> = {
  async editor(page, sample) {
    // キャンバスでは外側の要素から選ばれるので、レイヤーから見出しを選ぶ
    const name = sample.doc.nodes[headline(sample)].name;
    await tool(page, "layers-panel").locator(".layer-name").filter({ hasText: new RegExp(`^${escape(name)}$`) }).click();
  },
  async ai(page, sample) {
    await tool(page, "ai").click();
    await page.locator(".ai-input-row textarea").fill(sample.aiPrompt);
  },
  async publish(page) {
    await tool(page, "publish").click();
    await page.locator(".pub-modal").waitFor();
    await page.waitForTimeout(1000);
  },
  async comments(page, sample) {
    await tool(page, "comments").click();
    const thread = sample.comments.find((c) => c.replies && c.replies.length > 1) ?? sample.comments[0];
    await page.locator(".cm-item").filter({ hasText: thread.body }).click();
    await page.locator(".cm-detail textarea").fill(sample.replyDraft);
  },
  async help(page, sample) {
    await tool(page, "help").click();
    await page.getByRole("button", { name: new RegExp(`^${sample.help.category}`) }).first().click();
    await page.getByRole("button", { name: new RegExp(`^${escape(sample.help.article)}`) }).first().click();
  },
  async responsive(page) {
    await tool(page, "breakpoint-sm").click();
  },
  async scripts(page, sample) {
    // データの取得とクリック時の移動がある、商品一覧のページ
    await tool(page, "pages").click();
    await page.getByText("/catalog", { exact: true }).click();
    const edit = page.getByRole("button", { name: sample.labels.editScripts, exact: true });
    // 右パネルのスクリプト欄が閉じていれば開く
    if (!(await edit.isVisible())) await tool(page, "page-scripts").locator("button").first().click();
    await edit.click();
    await page.waitForTimeout(800);
  },
};

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  try {
    for (const lang of values.lang!.split(",")) {
      const sample: Sample = JSON.parse(readFileSync(resolve(root, `docs/screenshots/sample/${lang}.json`), "utf8"));
      for (const shot of SHOTS.filter((s) => !values.only || values.only.split(",").includes(s))) {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: lang === "ja" ? "ja-JP" : "en-US" });
        const page = await context.newPage();
        await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
        await openSample(page, sample);
        await take[shot](page, sample);
        // ホバーの強調やツールチップを写さない
        await page.mouse.move(800, 990);
        await page.waitForTimeout(500);
        await page.screenshot({ path: resolve(root, `docs/screenshots/${lang}/${shot}.png`) });
        console.log(`${lang}/${shot}.png`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

await main();
