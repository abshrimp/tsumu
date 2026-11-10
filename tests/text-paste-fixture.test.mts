import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatchTextPaste } from "../e2e/helpers/text-paste";

for (const ignoresConstructorData of [false, true]) {
  test(`synthetic paste preserves the handler payload when the constructor ignores data: ${ignoresConstructorData}`, () => {
    class Transfer {
      data = new Map<string, string>();
      setData(type: string, value: string) { this.data.set(type, value); }
      getData(type: string) { return this.data.get(type) ?? ""; }
    }
    class PasteEvent extends Event {
      #data: Transfer;
      constructor(type: string, init: EventInit & { clipboardData?: Transfer }) {
        super(type, init);
        this.#data = ignoresConstructorData ? new Transfer() : init.clipboardData ?? new Transfer();
      }
      get clipboardData() { return this.#data; }
    }
    const originals = new Map(["DataTransfer", "ClipboardEvent"].map(name =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    Object.assign(globalThis, { DataTransfer: Transfer, ClipboardEvent: PasteEvent });
    try {
      const target = new EventTarget();
      let received: string | undefined;
      target.addEventListener("paste", event => {
        received = (event as PasteEvent).clipboardData.getData("text/plain");
        event.preventDefault();
      });
      const text = "<&>\nHello {profile.name}\n\n";
      const result = dispatchTextPaste(target as HTMLElement, text);
      assert.equal(received, text);
      assert.deepEqual(result, { eventText: text, receivedText: text, canceled: true });
    } finally {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
}
