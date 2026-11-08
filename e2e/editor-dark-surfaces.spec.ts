import { expect, test } from "@playwright/test";
import { readEditorCss } from "../tests/helpers/editor-css";

/** Keep this fixture CSS-only so every palette check is independent of sign-in and storage. */
async function mount(page: import("@playwright/test").Page, theme: "light" | "dark") {
  await page.setContent(`<!doctype html><html data-editor-theme="${theme}"><head></head><body>
    <div class="se-side" style="width:300px"><button class="se-new">New script</button><button class="se-new is-on">Selected script</button></div>
    <section class="help" style="position:static;width:440px;max-width:none;overflow:visible;height:auto">
      <div class="help-hero"><div class="help-hero-icon">+</div><div class="help-hero-text"><strong>Help</strong><p>Instructions</p></div></div>
      <div class="help-cats">
        <button class="help-cat is-design"><span class="help-cat-icon">i</span><span class="help-cat-text"><span class="help-cat-label">Web design</span><span class="help-cat-desc">Basics</span></span><span class="help-cat-count">15</span></button>
      </div>
      <div class="help-rule"><div class="help-rule-head">Rule</div><p>Rule explanation</p></div>
      <div class="help-a">Help answer</div>
      <div class="help-warn">Warning</div>
      <span class="help-level is-l1">Basic</span><span class="help-level is-l3">Note</span><span class="help-level is-l4">Advanced</span>
      <div class="guide-status is-done">Done</div>
      <figure class="hf">
        <div class="hf-body"><div class="hf-side"><div class="hf-box">Box</div></div>
          <span class="hf-master">Component</span>
          <div class="hf-tree"><span class="is-picked">Picked</span></div>
          <span class="hf-node is-prod">Live</span>
        </div>
      </figure>
    </section>
    <aside class="panel-l" style="width:300px;height:auto">
      <div class="page-row is-on is-picked" style="position:relative;--acts:0"><input class="page-pick" type="checkbox" checked><span class="page-label">Home</span><div class="row-acts"><button class="row-act">Edit</button></div></div>
      <div class="layer-row">Layer</div>
      <div class="comp-row">Component</div>
      <button class="asset-del" style="display:block">Remove</button>
    </aside>
    <div class="img-pick" style="width:200px"><div class="img-pick-row"><button class="img-pick-thumb">Image</button><button class="img-pick-asset">Asset</button></div></div>
    <article class="home-card" style="width:300px"><div class="home-card-thumb"><span>H</span></div><div class="home-card-menu"><button class="icon-btn" style="opacity:1">...</button></div></article>
    <ul class="check-list"><li>Storage warning</li><li class="is-error">Database not configured</li></ul>
    <div class="check-ok">Saved</div>
    <div class="home-notice is-error">Home error</div>
    <div class="pub-card-error">Publish error</div>
    <div class="ai-msg is-error">AI error</div>
    <div class="ai-msg is-user">AI message</div>
    <div class="home-card is-skeleton" style="width:300px"></div>
    <div class="boot-card"><strong>Loading</strong><p class="boot-tip"><span>Tip</span>Use shortcuts.</p></div>
    <div class="code-token-tag">tag</div>
  </body></html>`);
  await page.addStyleTag({ content: readEditorCss() });
}
const css = (page: import("@playwright/test").Page, selector: string, property: string) =>
  page.locator(selector).first().evaluate((el, name) => getComputedStyle(el).getPropertyValue(name).trim(), property);

test("dark editor surfaces remain legible in scripts, help, image controls, pages and home cards", async ({ page }) => {
  await mount(page, "dark");

  await expect(page.locator(".se-new").first()).toHaveCSS("color", "rgb(16, 29, 50)");
  await expect(page.locator(".se-new.is-on")).toHaveCSS("color", "rgb(228, 239, 255)");
  await expect(page.locator(".help-hero-icon")).toHaveCSS("color", "rgb(16, 29, 50)");
  expect(await css(page, ".help-hero", "background-image")).toContain("rgb(43, 61, 88)");
  await expect(page.locator(".help-cat.is-design")).toHaveCSS("background-color", "rgb(60, 50, 34)");
  await expect(page.locator(".help-cat.is-design")).toHaveCSS("color", "rgb(233, 237, 244)");
  await expect(page.locator(".help-cat.is-design .help-cat-icon")).toHaveCSS("color", "rgb(255, 218, 154)");
  await expect(page.locator(".help-rule")).toHaveCSS("background-color", "rgb(60, 50, 34)");
  await expect(page.locator(".help-rule p")).toHaveCSS("color", "rgb(236, 220, 197)");
  await expect(page.locator(".help-a")).toHaveCSS("background-color", "rgb(45, 51, 60)");
  await expect(page.locator(".hf")).toHaveCSS("background-color", "rgb(37, 44, 54)");
  await expect(page.locator(".hf-side .hf-box")).toHaveCSS("background-color", "rgb(45, 51, 60)");
  await expect(page.locator(".hf-tree .is-picked")).toHaveCSS("background-color", "rgb(48, 68, 96)");
  await expect(page.locator(".hf-master")).toHaveCSS("color", "rgb(226, 202, 255)");
  await expect(page.locator(".hf-node.is-prod")).toHaveCSS("color", "rgb(16, 29, 50)");

  await expect(page.locator(".page-row.is-picked")).toHaveCSS("background-color", "rgb(44, 65, 97)");
  await expect(page.locator(".page-row.is-picked")).toHaveCSS("color", "rgb(228, 239, 255)");
  expect(await css(page, ".img-pick-thumb", "background-image")).toContain("rgb(48, 55, 65)");
  expect(await css(page, ".home-card-thumb", "background-image")).toContain("rgb(40, 51, 65)");
  await expect(page.locator(".home-card-menu .icon-btn")).toHaveCSS("color", "rgb(233, 237, 244)");
  await expect(page.locator(".home-card.is-skeleton")).toHaveCSS("background-image", /rgb\(45, 51, 60\)/);
  await expect(page.locator(".boot-card")).toHaveCSS("background-color", "rgba(32, 36, 43, 0.96)");
  await expect(page.locator(".boot-tip")).toHaveCSS("color", "rgb(197, 203, 213)");
  await expect(page.locator(".boot-tip span")).toHaveCSS("background-color", "rgb(44, 65, 97)");
  await expect(page.locator(".code-token-tag")).toHaveCSS("color", "rgb(215, 166, 255)");

  await expect(page.locator(".check-list li.is-error")).toHaveCSS("background-color", "rgb(75, 41, 46)");
  await expect(page.locator(".check-list li.is-error")).toHaveCSS("color", "rgb(255, 203, 198)");
  await expect(page.locator(".check-list li").first()).toHaveCSS("background-color", "rgb(67, 51, 33)");
  await expect(page.locator(".check-ok")).toHaveCSS("color", "rgb(178, 228, 195)");
  await expect(page.locator(".home-notice.is-error")).toHaveCSS("background-color", "rgb(75, 41, 46)");
  await expect(page.locator(".pub-card-error")).toHaveCSS("color", "rgb(255, 203, 198)");
  await expect(page.locator(".ai-msg.is-user")).toHaveCSS("color", "rgb(16, 29, 50)");
});

test("hover and active states do not bring back light-only editor backgrounds", async ({ page }) => {
  await mount(page, "dark");
  await page.locator(".help-cat.is-design").hover();
  await expect(page.locator(".help-cat.is-design")).toHaveCSS("background-color", "rgb(73, 59, 40)");
  await page.locator(".img-pick-asset").hover();
  await expect(page.locator(".img-pick-asset")).toHaveCSS("background-color", "rgb(58, 65, 77)");
  await page.locator(".page-row.is-picked").hover();
  await expect(page.locator(".page-row.is-picked")).toHaveCSS("background-color", "rgb(44, 65, 97)");
  await page.locator(".layer-row").hover();
  await expect(page.locator(".layer-row")).toHaveCSS("background-color", "rgb(58, 65, 77)");
});

test("light-mode colors are unchanged, and switching themes updates the same surfaces", async ({ page }) => {
  await mount(page, "light");
  await expect(page.locator(".help-cat.is-design")).toHaveCSS("background-color", "rgb(255, 251, 235)");
  await expect(page.locator(".help-rule")).toHaveCSS("background-color", "rgb(255, 250, 235)");
  await expect(page.locator(".page-row.is-picked")).toHaveCSS("background-color", "rgb(232, 240, 254)");
  await expect(page.locator(".se-new").first()).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.locator(".check-list li.is-error")).toHaveCSS("background-color", "rgb(254, 242, 242)");

  await page.evaluate(() => { document.documentElement.dataset.editorTheme = "dark"; });
  await expect(page.locator(".help-rule")).toHaveCSS("background-color", "rgb(60, 50, 34)");
  await expect(page.locator(".page-row.is-picked")).toHaveCSS("background-color", "rgb(44, 65, 97)");
  await expect(page.locator(".check-list li.is-error")).toHaveCSS("background-color", "rgb(75, 41, 46)");
  await page.evaluate(() => { document.documentElement.dataset.editorTheme = "light"; });
  await expect(page.locator(".help-rule")).toHaveCSS("background-color", "rgb(255, 250, 235)");
});
