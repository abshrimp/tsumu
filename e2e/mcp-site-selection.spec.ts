import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { buildSync } from "../tests/helpers/bundle";
const HOSTED_EDITOR_ORIGIN = "https://studio.example.test";
const TRUSTED_MCP_ORIGIN = "https://relay.example.test";

const nonce = "a".repeat(22);
const invite = "00000000-0000-4000-8000-000000000000." + "b".repeat(43);
const site = { id: "example", name: "Example site", accessRole: "viewer" };
let bundle: string;

test.beforeAll(() => {
  bundle = buildSync({
    stdin: {
      contents: `
        import { StrictMode } from "react";
        import { createRoot } from "react-dom/client";
        import Chooser from "./app/mcp/choose/client";
        import Bridge from "./app/mcp/sites-bridge/client";
        const View = location.pathname === "/mcp/choose" ? Chooser : Bridge;
        createRoot(document.getElementById("root")).render(<StrictMode><View /></StrictMode>);
      `,
      loader: "tsx", resolveDir: resolve("."),
    },
    bundle: true, write: false, jsx: "automatic", platform: "browser",
    define: {
      "process.env.NODE_ENV": '"development"',
      "process.env.NEXT_PUBLIC_TSUMU_HOSTED_EDITOR_ORIGIN": JSON.stringify(HOSTED_EDITOR_ORIGIN),
      "process.env.NEXT_PUBLIC_TSUMU_MCP_URL": JSON.stringify(TRUSTED_MCP_ORIGIN),
    },
  }).outputFiles[0].text;
});

test.beforeEach(async ({ context }) => {
  // Serve both origins locally, including the popup's first navigation.
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === TRUSTED_MCP_ORIGIN && url.pathname === "/parent") {
      await route.fulfill({ contentType: "text/html", body: `
        <output></output>
        <script>addEventListener("message", event => {
          if (event.origin === ${JSON.stringify(HOSTED_EDITOR_ORIGIN)}) {
            document.querySelector("output").textContent = JSON.stringify(event.data);
          }
        });</script>
        <iframe src="${HOSTED_EDITOR_ORIGIN}/mcp/sites-bridge#nonce=${nonce}"></iframe>` });
    } else if (url.origin !== HOSTED_EDITOR_ORIGIN) {
      await route.abort();
    } else if (url.pathname === "/api/sites") {
      await route.fulfill({ json: { sites: [site] } });
    } else if (url.pathname === "/fixture.js") {
      await route.fulfill({ contentType: "text/javascript", body: bundle });
    } else if (url.pathname === "/mcp/choose" || url.pathname === "/mcp/sites-bridge") {
      await route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/fixture.js"></script>' });
    } else {
      await route.fulfill({ status: 200, contentType: "text/html", body: "" });
    }
  });
});

test("the chooser retains the invite across Strict Mode replay and a closed popup", async ({ page }) => {
  const chooser = HOSTED_EDITOR_ORIGIN + "/mcp/choose";
  await page.goto(chooser + "#invite=" + invite);
  const button = page.getByRole("button", { name: /Example site/ });
  await expect(button).toBeEnabled();
  await expect(page).toHaveURL(chooser);

  const openSite = async () => {
    const [popup] = await Promise.all([page.waitForEvent("popup"), button.click()]);
    await expect(popup).toHaveURL(HOSTED_EDITOR_ORIGIN + "/sites/example#mcp-join=" + invite + "&edit=0&site=example");
    return popup;
  };
  const first = await openSite();
  await expect(button).toBeDisabled();
  await first.close();
  await expect(button).toBeEnabled();

  const retry = await openSite();
  await retry.evaluate(() => window.opener.postMessage({
    type: "tsumu-mcp-site-ready", siteId: "example", ok: true,
  }, location.origin));
  await expect(page.getByRole("status")).toContainText("サイトへのアクセスを追加しました");
  await expect(button).toBeDisabled();
});

test("the embedded directory replies with the original nonce after Strict Mode replay", async ({ page }) => {
  await page.goto(TRUSTED_MCP_ORIGIN + "/parent");
  await expect(page.locator("output")).toHaveText(JSON.stringify({
    type: "tsumu-mcp-sites", nonce,
    sites: [{ id: site.id, name: site.name, canEdit: false }], unavailable: false,
  }));
  expect(page.frames()[1].url()).toBe(HOSTED_EDITOR_ORIGIN + "/mcp/sites-bridge");
});
