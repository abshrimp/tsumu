import { test, expect } from "@playwright/test";
import { parseColor } from "../components/controls";

for (const [value, hex, alpha] of [
  ["red", "#ff0000", 1],
  ["hsl(120 100% 50% / 0.5)", "#00ff00", 0.5],
] as const) {
  test(`color picker preserves native CSS color ${value}`, async ({ page }) => {
    expect(await page.evaluate(parseColor, value)).toEqual({ hex, alpha });
  });
}
