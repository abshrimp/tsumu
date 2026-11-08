import { test, expect } from "@playwright/test";

test("invalid JSON shapes get a client error from fetch and publishing endpoints", async ({ request }) => {
  for (const [url, body] of [
    ["/api/fetch-json", '{"method":{},"url":"https://example.org"}'],
    ["/api/publish", "null"],
    ["/api/publish/history", "null"],
  ]) {
    const response = await request.post(url, {
      headers: { "Content-Type": "application/json" }, data: body,
    });
    expect(response.status(), url).toBe(400);
  }
});
