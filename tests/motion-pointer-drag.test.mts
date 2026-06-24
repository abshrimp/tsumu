import assert from "node:assert/strict";
import { test } from "node:test";
import { trackMotionPointer } from "../lib/motion-pointer-drag";

function pointer(type: string, pointerId = 1, x = 10, buttons = 1): PointerEvent {
  return Object.assign(new Event(type), { pointerId, clientX: x, buttons }) as PointerEvent;
}

function fixture() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = new EventTarget();
  const target = Object.assign(new EventTarget(), {
    captured: null as number | null,
    setPointerCapture(id: number) { this.captured = id; },
    hasPointerCapture(id: number) { return this.captured === id; },
    releasePointerCapture(id: number) {
      this.captured = null;
      this.dispatchEvent(pointer("lostpointercapture", id));
    },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  const moves: number[] = [];
  const ends: (number | null)[] = [];
  const start = () => trackMotionPointer({ pointerId: 1 }, target as unknown as Element,
    (event) => moves.push(event.clientX), (event) => ends.push(event?.clientX ?? null));
  const restore = () => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  };
  return { events, target, moves, ends, start, restore };
}

test("motion drag ignores other pointers and finishes the initiating pointer once", () => {
  const f = fixture();
  try {
    f.start();
    for (const type of ["pointermove", "pointerup", "pointercancel"]) f.events.dispatchEvent(pointer(type, 2));
    f.target.dispatchEvent(pointer("lostpointercapture", 2));
    assert.deepEqual(f.moves, []);
    assert.deepEqual(f.ends, []);
    f.events.dispatchEvent(pointer("pointermove", 1, 25));
    f.events.dispatchEvent(pointer("pointerup", 1, 30, 0));
    f.events.dispatchEvent(pointer("pointermove", 1, 40));
    assert.deepEqual(f.moves, [25]);
    assert.deepEqual(f.ends, [30]);
    assert.equal(f.target.captured, null);
  } finally { f.restore(); }
});

for (const interruption of ["pointercancel", "lostpointercapture", "blur", "released outside"]) {
  test(`motion ${interruption} ends once, ignores later moves, and allows another drag`, () => {
    const f = fixture();
    try {
      f.start();
      f.events.dispatchEvent(pointer("pointermove", 1, 20));
      if (interruption === "lostpointercapture") f.target.releasePointerCapture(1);
      else if (interruption === "blur") f.events.dispatchEvent(new Event("blur"));
      else if (interruption === "released outside") f.events.dispatchEvent(pointer("pointermove", 1, 80, 0));
      else f.events.dispatchEvent(pointer("pointercancel", 1, 0, 0));
      f.events.dispatchEvent(pointer("pointermove", 1, 50));
      f.events.dispatchEvent(pointer("pointerup", 1, 50, 0));
      assert.deepEqual(f.moves, [20]);
      assert.deepEqual(f.ends, [null]);
      assert.equal(f.target.captured, null);
      f.start();
      f.events.dispatchEvent(pointer("pointermove", 1, 60));
      f.events.dispatchEvent(pointer("pointerup", 1, 70, 0));
      assert.deepEqual(f.moves, [20, 60]);
      assert.deepEqual(f.ends, [null, 70]);
    } finally { f.restore(); }
  });
}

test("disposing a motion editor removes listeners without finalizing discarded edits", () => {
  const f = fixture();
  try {
    const cleanup = f.start();
    f.events.dispatchEvent(pointer("pointermove", 1, 20));
    cleanup();
    cleanup();
    for (const type of ["pointermove", "pointercancel", "pointerup"]) f.events.dispatchEvent(pointer(type));
    f.events.dispatchEvent(new Event("blur"));
    assert.deepEqual(f.moves, [20]);
    assert.deepEqual(f.ends, []);
    assert.equal(f.target.captured, null);
  } finally { f.restore(); }
});
