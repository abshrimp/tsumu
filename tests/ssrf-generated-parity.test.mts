import assert from "node:assert/strict";
import { test } from "node:test";
import { generateExportProject } from "../lib/export-formats";
import { BlockedUrlError, assertPublicUrl, isPrivateHost } from "../lib/safe-fetch";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

function fixture(): SiteDoc {
  return {
    siteName: "SSRF boundary fixture", pageOrder: ["home"], assets: {},
    pages: { home: {
      id: "home", name: "Home", title: "Home", slug: "",
      description: "", children: ["node"],
    }},
    nodes: { node: { ...makeBox(), id: "node", name: "Node" } },
  };
}

type PublicRequest = (uri: string, init: RequestInit, base: string,
  localFetch: (uri: string, init: RequestInit) => Promise<Response>) => Promise<Response>;

test("server API and generated SSR refuse private destinations before any HTTP request", async () => {
  // 書き出した SSR のランタイムは、lib/safe-fetch から写したものではなく、実際に生成した JavaScript
  // として読み込む。写しのほうの回帰は、別に見つけられる。
  const project = generateExportProject(fixture(), "sveltekit");
  const generated = project.files["src/lib/server-request.js"];
  assert.ok(generated, "SvelteKit must ship its request policy");
  const { requestPublic } = await import("data:text/javascript;base64," +
    Buffer.from(generated).toString("base64")) as { requestPublic: PublicRequest };

  const hosts = [
    "127.0.0.1", "127.1", "2130706433", "0x7f000001",
    "10.1.2.3", "172.31.255.255", "192.168.0.1", "169.254.169.254",
    "100.100.100.200", "198.18.0.1", "198.51.100.5", "203.0.113.7",
    "0.0.0.0", "[::1]", "[::ffff:127.0.0.1]", "[fe80::1]",
    "[2001:db8::1]", "[2002::1]", "localhost", "metadata.google.internal",
    "router.lan", "database",
  ];
  const previousFetch = globalThis.fetch;
  let outbound = 0, local = 0;
  globalThis.fetch = async () => {
    outbound++;
    return new Response("{}", { status: 200 });
  };
  const localFetch = async () => {
    local++;
    return new Response("{}", { status: 200 });
  };
  try {
    for (const hostname of hosts) {
      for (const scheme of ["http:", "https:"]) {
        const raw = scheme + "//" + hostname + "/metadata?secret=probe";
        const url = new URL(raw);
        assert.ok(isPrivateHost(url.hostname), "API guard missed " + raw);
        await assert.rejects(
          assertPublicUrl(raw),
          (error: unknown) => error instanceof BlockedUrlError,
          "API accepted " + raw,
        );
        await assert.rejects(
          requestPublic(raw, {}, "https://published.example", localFetch),
          undefined, "Generated SSR accepted " + raw,
        );
      }
    }
    // URL のユーザー名やパスワードで、公開のホスト名が方針を迂回できてはならない。
    const credentialed = "https://user:secret@1.1.1.1/private";
    await assert.rejects(assertPublicUrl(credentialed), BlockedUrlError);
    await assert.rejects(requestPublic(credentialed, {}, "https://published.example", localFetch));
    assert.equal(outbound, 0, "a private address was fetched");
    assert.equal(local, 0, "a private address was sent to the local fetch");

    // 通るべきものも確かめ、API のネットワークの方針と、生成した SSR のより厳しい明示的なオリジンの
    // 許可リストを区別する。公開の IP は、API では許されるが、それを許可リストに入れていないサイトでは許されない。
    const allowed = "https://1.1.1.1/public";
    assert.equal((await assertPublicUrl(allowed)).href, allowed);
    await assert.rejects(
      requestPublic(allowed, {}, "https://published.example", localFetch),
      /origin is not allowed/,
    );
    assert.equal(outbound, 0);
    assert.equal(local, 0);

    // 同じオリジンの相対のデータの API は、外部のネットワークに接続せず、生成したフレームワークの
    // ローカルの fetch を通して、引き続き動かなければならない。
    const response = await requestPublic("/api/safe", {}, "https://published.example", localFetch);
    assert.equal(response.status, 200);
    assert.equal(local, 1);
    assert.equal(outbound, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
