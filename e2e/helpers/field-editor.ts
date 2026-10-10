import type { Page } from "@playwright/test";
import type { SiteDoc } from "../../lib/types";

declare const fieldFixture: { mount(doc: SiteDoc): Promise<void> };

export function fieldEditorFixture(build: () => Promise<string>) {
  let bundle: Promise<string> | undefined;
  return async (page: Page, doc: SiteDoc) => {
    bundle ??= build();
    await page.addScriptTag({ content: await bundle });
    await page.evaluate(doc => fieldFixture.mount(doc), doc);
  };
}
