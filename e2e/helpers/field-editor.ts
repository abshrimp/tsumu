import type { Page } from "@playwright/test";
import type { SiteDoc } from "../../lib/types";

declare const fieldFixture: { mount(doc: SiteDoc): Promise<void> } | undefined;

export function fieldEditorFixture(build: () => Promise<string>) {
  let bundle: Promise<string> | undefined;
  return async (page: Page, doc: SiteDoc) => {
    bundle ??= build();
    if (!(await page.evaluate(() => typeof fieldFixture === "object" && fieldFixture !== null))) {
      await page.addScriptTag({ content: await bundle });
    }
    await page.evaluate((doc) => fieldFixture!.mount(doc), doc);
  };
}
