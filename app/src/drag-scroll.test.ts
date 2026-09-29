import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachDragScroll,
  type DragScrollElement,
  type DragScrollOptions,
  dragScrollPosition,
  releaseVelocity,
} from "./drag-scroll.ts";

type FakeEvent = {
  type: string;
  button: number;
  pointerId: number;
  clientX: number;
  clientY: number;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
};

type Handler = (event: FakeEvent) => void;

function fakeElement(size = { width: 2000, height: 1000 }) {
  const listeners = new Map<string, Handler[]>();
  const classes = new Set<string>();
  const captured = new Set<number>();
  let left = 0;
  let top = 0;
  const element = {
    get scrollLeft() {
      return left;
    },
    set scrollLeft(value: number) {
      left = Math.min(Math.max(value, 0), size.width);
    },
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      top = Math.min(Math.max(value, 0), size.height);
    },
    addEventListener(type: string, handler: Handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    removeEventListener(type: string, handler: Handler) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((entry) => entry !== handler),
      );
    },
    setPointerCapture: (id: number) => captured.add(id),
    releasePointerCapture: (id: number) => captured.delete(id),
    hasPointerCapture: (id: number) => captured.has(id),
    classList: {
      toggle: (token: string, force?: boolean) =>
        force ? classes.add(token) : classes.delete(token),
    },
  };

  const dispatch = (
    type: string,
    init: Partial<Pick<FakeEvent, "button" | "clientX" | "clientY">> = {},
  ) => {
    const event: FakeEvent = {
      type,
      button: init.button ?? 0,
      pointerId: 1,
      clientX: init.clientX ?? 0,
      clientY: init.clientY ?? 0,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        event.defaultPrevented = true;
      },
      stopPropagation() {
        event.propagationStopped = true;
      },
    };
    for (const handler of listeners.get(type) ?? []) {
      handler(event);
    }
    return event;
  };

  return {
    element: element as unknown as DragScrollElement,
    dispatch,
    classes,
    captured,
    listenerCount: () =>
      [...listeners.values()].reduce((sum, list) => sum + list.length, 0),
  };
}

function attach(
  fake: ReturnType<typeof fakeElement>,
  options: Partial<DragScrollOptions> = {},
) {
  let time = 0;
  const frames: (() => void)[] = [];
  const detach = attachDragScroll(fake.element, {
    canStart: (event) => event.button === 1,
    suppressMiddleClick: true,
    reducedMotion: () => false,
    now: () => time,
    requestFrame: (callback) => frames.push(callback),
    cancelFrame: () => {
      frames.splice(0);
    },
    ...options,
  });
  return {
    detach,
    frames,
    advance(ms: number) {
      time += ms;
    },
    runFrames(ms = 16) {
      let count = 0;
      while (frames.length && count < 1000) {
        time += ms;
        frames.shift()?.();
        count += 1;
      }
      return count;
    },
  };
}

describe("drag scroll position", () => {
  it("moves content with the pointer on the chosen axes", () => {
    const origin = { left: 300, top: 100 };
    const start = { x: 50, y: 50 };
    const current = { x: 20, y: 90 };
    assert.deepEqual(dragScrollPosition("both", origin, start, current), {
      left: 330,
      top: 60,
    });
    assert.deepEqual(dragScrollPosition("x", origin, start, current), {
      left: 330,
      top: 100,
    });
    assert.deepEqual(dragScrollPosition("y", origin, start, current), {
      left: 300,
      top: 60,
    });
  });

  it("measures release velocity over the recent samples only", () => {
    const samples = [
      { t: 0, x: 0, y: 0 },
      { t: 200, x: 100, y: 0 },
      { t: 250, x: 150, y: 10 },
      { t: 300, x: 200, y: 20 },
    ];
    assert.deepEqual(releaseVelocity(samples, 310), { x: 1, y: 0.2 });
    // A pause before release cancels the fling.
    assert.deepEqual(releaseVelocity(samples, 400), { x: 0, y: 0 });
    assert.deepEqual(releaseVelocity([], 0), { x: 0, y: 0 });
  });
});

describe("attachDragScroll", () => {
  it("claims an accepted press and scrolls 1:1 on both axes", () => {
    const fake = fakeElement();
    fake.element.scrollLeft = 500;
    fake.element.scrollTop = 200;
    attach(fake);

    const down = fake.dispatch("pointerdown", {
      button: 1,
      clientX: 100,
      clientY: 100,
    });
    assert.equal(down.defaultPrevented, true);
    // Stopped in the capture phase, so lane, clip and ruler handlers never
    // start a selection, clip drag or scrub.
    assert.equal(down.propagationStopped, true);
    assert.ok(fake.captured.has(1));
    assert.ok(fake.classes.has("is-drag-scrolling"));

    fake.dispatch("pointermove", { clientX: 40, clientY: 130 });
    assert.equal(fake.element.scrollLeft, 560);
    assert.equal(fake.element.scrollTop, 170);

    fake.dispatch("pointercancel", { clientX: 40, clientY: 130 });
    assert.equal(fake.classes.has("is-drag-scrolling"), false);
    assert.equal(fake.captured.has(1), false);
  });

  it("leaves presses it does not accept to the content", () => {
    const fake = fakeElement();
    attach(fake);

    const down = fake.dispatch("pointerdown", { button: 0, clientX: 100 });
    assert.equal(down.defaultPrevented, false);
    assert.equal(down.propagationStopped, false);
    fake.dispatch("pointermove", { clientX: 10 });
    assert.equal(fake.element.scrollLeft, 0);
    assert.equal(fake.classes.has("is-drag-scrolling"), false);
  });

  it("suppresses middle-click autoscroll and paste only", () => {
    const fake = fakeElement();
    attach(fake);

    for (const type of ["mousedown", "mouseup", "auxclick"]) {
      assert.equal(fake.dispatch(type, { button: 1 }).defaultPrevented, true);
      assert.equal(fake.dispatch(type, { button: 0 }).defaultPrevented, false);
      assert.equal(fake.dispatch(type, { button: 2 }).defaultPrevented, false);
    }
  });

  it("flings after a quick release and stops at the content edge", () => {
    const fake = fakeElement();
    fake.element.scrollLeft = 1000;
    const drag = attach(fake);

    fake.dispatch("pointerdown", { button: 1, clientX: 500 });
    for (let step = 1; step <= 5; step += 1) {
      drag.advance(10);
      fake.dispatch("pointermove", { clientX: 500 - step * 20 });
    }
    assert.equal(fake.element.scrollLeft, 1100);
    drag.advance(5);
    fake.dispatch("pointerup", { clientX: 400 });

    assert.equal(drag.frames.length, 1);
    drag.runFrames();
    assert.ok(fake.element.scrollLeft > 1100);
    assert.ok(fake.element.scrollLeft <= 2000);
    assert.equal(drag.frames.length, 0);
  });

  it("does not fling when motion is reduced", () => {
    const fake = fakeElement();
    const drag = attach(fake, { reducedMotion: () => true });

    fake.dispatch("pointerdown", { button: 1, clientX: 500 });
    drag.advance(10);
    fake.dispatch("pointermove", { clientX: 400 });
    drag.advance(5);
    fake.dispatch("pointerup", { clientX: 400 });
    assert.equal(fake.element.scrollLeft, 100);
    assert.equal(drag.frames.length, 0);
  });

  it("stops a fling on the next press", () => {
    const fake = fakeElement();
    const drag = attach(fake);

    fake.dispatch("pointerdown", { button: 1, clientX: 500 });
    drag.advance(10);
    fake.dispatch("pointermove", { clientX: 400 });
    drag.advance(5);
    fake.dispatch("pointerup", { clientX: 400 });
    assert.equal(drag.frames.length, 1);

    fake.dispatch("pointerdown", { button: 0 });
    assert.equal(drag.frames.length, 0);
  });

  it("removes every listener on detach", () => {
    const fake = fakeElement();
    const drag = attach(fake);
    assert.ok(fake.listenerCount() > 0);
    drag.detach();
    assert.equal(fake.listenerCount(), 0);
  });
});
