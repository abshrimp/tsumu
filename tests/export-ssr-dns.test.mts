import assert from "node:assert/strict";
import { test } from "node:test";
import { generateExportProject } from "../lib/export-formats";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

test("generated Node SSR transport blocks private DNS answers at socket connection time", async () => {
  const doc: SiteDoc = {
    siteName: "External fetch check", pageOrder: ["home"],
    pages: { home: { id: "home", name: "Home", title: "Home", slug: "",
      description: "", children: ["item"],
      pageScripts: [{ id: "load", trigger: "load", pos: { x: 0, y: 0 },
        steps: [{ id: "get", kind: "fetch", url: "https://public.example.test/data", as: "data" }] }],
    } },
    nodes: { item: { ...makeBox(), id: "item" } }, assets: {},
  };
  const project = generateExportProject(doc, "sveltekit");
  const source = project.files["src/lib/server-request.js"];
  assert.match(source, /Private DNS address blocked/);
  assert.match(source, /agent: false/);
  assert.match(source, /bytes > 5 \* 1024 \* 1024/);
  const { requestPublic } = await import("data:text/javascript;base64," +
    Buffer.from(source).toString("base64")) as {
    requestPublic: (url: string, opts: RequestInit, base: string,
      local: (url: string) => Promise<Response>) => Promise<Response>;
  };

  const processModule = process as typeof process & {
    getBuiltinModule?: (name: string) => unknown;
  };
  const descriptor = Object.getOwnPropertyDescriptor(processModule, "getBuiltinModule");
  let requests = 0, lookups = 0, outbound = 0;
  Object.defineProperty(processModule, "getBuiltinModule", {
    configurable: true, writable: true,
    value: (name: string): unknown => {
      if (name === "node:dns") return {
        lookup(_host: string, options: { family: number }, cb: Function) {
          lookups++;
          assert.equal(options.family, 4);
          cb(null, [{ address: "127.0.0.1", family: 4 }]);
        },
      };
      if (name === "node:https") return {
        request(_target: URL, opts: {
          lookup: (host: string, flags: unknown, callback: Function) => void;
          agent: boolean;
        }) {
          requests++;
          assert.equal(opts.agent, false);
          let errorHandler: (error: Error) => void = () => {};
          return {
            on(event: string, callback: (error: Error) => void) {
              if (event === "error") errorHandler = callback;
              return this;
            },
            end() {
              opts.lookup("public.example.test", {}, (error: Error | null) => {
                if (error) errorHandler(error);
                else throw new Error("The DNS pinning check incorrectly permitted loopback");
              });
            },
          };
        },
      };
      throw new Error("Unexpected builtin request: " + name);
    },
  });
  try {
    await assert.rejects(
      requestPublic("https://public.example.test/data", {}, "https://site.example",
        async () => { outbound++; throw new Error("No local request expected"); }),
      /Private DNS address blocked/);
    assert.equal(requests, 1);
    assert.equal(lookups, 1);
    assert.equal(outbound, 0);
  } finally {
    if (descriptor) Object.defineProperty(processModule, "getBuiltinModule", descriptor);
    else Reflect.deleteProperty(processModule, "getBuiltinModule");
  }
});
