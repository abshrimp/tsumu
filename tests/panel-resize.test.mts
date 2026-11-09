import assert from "node:assert/strict";
import { test } from "node:test";
import { trackPanelResize } from "../lib/panel-resize";

function pointer(type: string, id = 1, x = 10, buttons = 1) {
  return Object.assign(new Event(type), { pointerId: id, clientX: x, buttons }) as PointerEvent;
}

function fixture() {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const windowEvents = new EventTarget();
  const documentEvents = new EventTarget();
  const classes = new Set<string>();
  const body = {
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
  };
  Object.assign(documentEvents, { body, visibilityState: "visible" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowEvents });
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentEvents });
  const makeTarget = () => Object.assign(new EventTarget(), {
    captured: new Set<number>(),
    setPointerCapture(id: number) { this.captured.add(id); },
    hasPointerCapture(id: number) { return this.captured.has(id); },
    releasePointerCapture(id: number) {
      this.captured.delete(id);
      this.dispatchEvent(pointer("lostpointercapture", id, 0, 0));
    },
  });
  const target = makeTarget();
  const widths: number[] = [], finishes: number[] = [];
  const start = (id = 1, element = target, initialWidth = 280, dir: 1 | -1 = 1) =>
    trackPanelResize(pointer("pointerdown", id, 10), element as unknown as HTMLElement,
      initialWidth, dir, (width) => widths.push(width), () => finishes.push(id));
  const move = (id = 1, x = 50, buttons = 1) =>
    windowEvents.dispatchEvent(pointer("pointermove", id, x, buttons));
  const release = (type = "pointerup", id = 1) =>
    windowEvents.dispatchEvent(pointer(type, id, 50, 0));
  const restore = () => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  };
  return { windowEvents, documentEvents, body, classes, target, makeTarget, widths, finishes, start, move, release, restore };
}

test("panel resize only follows its own pointer and stops after release", () => {
  const f = fixture();
  try {
    f.start();
    assert.ok(f.body.classList.contains("is-resizing-panel"));
    f.move(2, 999);
    f.release("pointercancel", 2);
    f.release("pointerup", 2);
    f.target.dispatchEvent(pointer("lostpointercapture", 2));
    assert.deepEqual(f.widths, []);
    assert.deepEqual(f.finishes, []);
    f.move(1, 60);
    assert.deepEqual(f.widths, [330]);
    f.release();
    f.move(1, 120);
    f.release();
    assert.deepEqual(f.widths, [330]);
    assert.deepEqual(f.finishes, [1]);
    assert.equal(f.target.captured.size, 0);
    assert.equal(f.body.classList.contains("is-resizing-panel"), false);
  } finally { f.restore(); }
});

for (const end of ["pointercancel", "blur", "hidden", "released-outside", "capture-loss", "unmount"] as const) {
  test(`panel resize ${end} cleans up and permits subsequent edits`, () => {
    const f = fixture();
    try {
      const dispose = f.start();
      f.move(1, 45);
      assert.deepEqual(f.widths, [315]);
      if (end === "pointercancel") f.release("pointercancel");
      if (end === "blur") f.windowEvents.dispatchEvent(new Event("blur"));
      if (end === "hidden") {
        (f.documentEvents as any).visibilityState = "hidden";
        f.documentEvents.dispatchEvent(new Event("visibilitychange"));
      }
      if (end === "released-outside") f.move(1, 120, 0);
      if (end === "capture-loss") f.target.releasePointerCapture(1);
      if (end === "unmount") dispose();
      f.move(1, 150);
      f.release();
      dispose();
      assert.deepEqual(f.widths, [315]);
      assert.deepEqual(f.finishes, [1]);
      assert.equal(f.target.captured.size, 0);
      assert.equal(f.body.classList.contains("is-resizing-panel"), false);
      (f.documentEvents as any).visibilityState = "visible";
      const again = f.start();
      f.move(1, 55);
      f.release();
      assert.deepEqual(f.widths, [315, 325]);
      assert.deepEqual(f.finishes, [1, 1]);
      again();
    } finally { f.restore(); }
  });
}

test("simultaneous panel drags keep the shared resize cursor until both end", () => {
  const f = fixture();
  try {
    const right = f.makeTarget();
    const leftStop = f.start(1);
    const rightStop = f.start(2, right, 300, -1);
    assert.equal(f.body.classList.contains("is-resizing-panel"), true);
    f.move(1, 40);
    f.move(2, 20);
    assert.deepEqual(f.widths, [310, 290]);
    f.release("pointercancel", 1);
    assert.equal(f.body.classList.contains("is-resizing-panel"), true);
    f.move(2, 30);
    f.release("pointerup", 2);
    assert.deepEqual(f.widths, [310, 290, 280]);
    assert.equal(f.body.classList.contains("is-resizing-panel"), false);
    assert.deepEqual(f.finishes, [1, 2]);
    leftStop(); rightStop();
  } finally { f.restore(); }
});
