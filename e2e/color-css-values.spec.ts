import { test, expect } from "@playwright/test";
import { parseColor } from "../components/controls";

for (const [value, hex, alpha] of [
  ["red", "#ff0000", 1],
  ["transparent", "#000000", 0],
  ["hsl(120 100% 50% / 0.5)", "#00ff00", 0.5],
  ["rgb(100% 0% 0% / 50%)", "#ff0000", 0.5],
  ["RGB(255, 0, 0)", "#ff0000", 1],
  ["rgb(300, 0, 0)", "#ff0000", 1],
] as const) {
  test(`color picker preserves native CSS color ${value}`, async ({ page }) => {
    expect(await page.evaluate(parseColor, value)).toEqual({ hex, alpha });
  });
}
