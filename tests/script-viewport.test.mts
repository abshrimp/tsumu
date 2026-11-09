import assert from "node:assert/strict";
import { test } from "node:test";
import { observeScriptViewport } from "../components/script-editor/visibility";

test("offscreen focused windows are released after focus leaves, without another intersection", async (t) => {
  const observers: FakeObserver[] = [];
  class FakeObserver {
    targets = new Set<Element>();
    disconnected = false;
    constructor(private callback: IntersectionObserverCallback) { observers.push(this); }
    observe(el: Element) { this.targets.add(el); }
    unobserve(el: Element) { this.targets.delete(el); }
    disconnect() { this.disconnected = true; }
    intersect(el: Element, visible: boolean) {
      this.callback([{ target: el, isIntersecting: visible } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver);
    }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
  Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: FakeObserver });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "IntersectionObserver", previous);
    else Reflect.deleteProperty(globalThis, "IntersectionObserver");
  });
  const doc = { activeElement: null as object | null };
  const workspace = {};
  class WindowElement extends EventTarget {
    ownerDocument = doc;
    fields = [{}, {}];
    closest() { return workspace; }
    contains(el: object | null) { return !!el && this.fields.includes(el); }
  }
  const chunk = new WindowElement();
  const stack = new WindowElement();
  const chunkStates: boolean[] = [];
  const stackStates: boolean[] = [];
  const stopChunk = observeScriptViewport(chunk as unknown as HTMLElement, (v) => chunkStates.push(v));
  const stopStack = observeScriptViewport(stack as unknown as HTMLElement, (v) => stackStates.push(v));
  t.after(stopChunk);
  t.after(stopStack);
  assert.equal(observers.length, 1, "chunks and stacks share one observer");
  const observer = observers[0];
  const intersect = (el: WindowElement, visible: boolean) => observer.intersect(el as unknown as Element, visible);

  intersect(chunk, true);
  doc.activeElement = chunk.fields[0];
  intersect(chunk, false);
  assert.equal(chunkStates.at(-1), true, "scrolling must retain the focused draft");

  chunk.dispatchEvent(new Event("focusout"));
  doc.activeElement = chunk.fields[1];
  await Promise.resolve();
  assert.equal(chunkStates.at(-1), true, "moving between fields must retain the window");

  chunk.dispatchEvent(new Event("focusout"));
  doc.activeElement = stack.fields[0];
  await Promise.resolve();
  assert.equal(chunkStates.at(-1), false, "focus departure must release an offscreen window");
  intersect(stack, true);
  intersect(stack, false);
  assert.equal(stackStates.at(-1), true);
  stack.dispatchEvent(new Event("focusout"));
  doc.activeElement = null;
  await Promise.resolve();
  assert.equal(stackStates.at(-1), false, "whole stacks use the same focus protection");

  chunk.dispatchEvent(new Event("focusout"));
  intersect(chunk, true);
  await Promise.resolve();
  assert.equal(chunkStates.at(-1), true, "reentry supersedes a queued offscreen focus check");
  chunk.dispatchEvent(new Event("focusout"));
  await Promise.resolve();
  assert.equal(chunkStates.at(-1), true, "visible windows stay mounted after blur");

  doc.activeElement = chunk.fields[0];
  intersect(chunk, false);
  chunk.dispatchEvent(new Event("focusout"));
  const count = chunkStates.length;
  stopChunk();
  doc.activeElement = null;
  await Promise.resolve();
  chunk.dispatchEvent(new Event("focusout"));
  intersect(chunk, true);
  await Promise.resolve();
  assert.equal(chunkStates.length, count, "cleanup cancels queued focus work and intersection delivery");
  assert.equal(observer.targets.size, 1);
  assert.equal(observer.disconnected, false);
  stopStack();
  assert.equal(observer.disconnected, true);
});
