import { commands } from "vitest/browser";
import "./commands.ts";

// Real mouse input through Playwright's mouse (commands.ts), in the shape
// the FX tests use: drags with steps in between, held buttons, multi-clicks
// and the wheel. Coordinates are the test page's client coordinates.

type Button = "left" | "middle" | "right";
type Press = { button?: Button; clickCount?: number };

export const mouse = {
  move: (x: number, y: number, { steps = 1 }: { steps?: number } = {}) =>
    commands.mouseMove(x, y, steps),
  down: ({ button = "left", clickCount = 1 }: Press = {}) =>
    commands.mouseDown(button, clickCount),
  up: ({ button = "left", clickCount = 1 }: Press = {}) =>
    commands.mouseUp(button, clickCount),
  async click(x: number, y: number, { button, clickCount = 1 }: Press = {}) {
    await mouse.move(x, y);
    for (let count = 1; count <= clickCount; count++) {
      await mouse.down({ button, clickCount: count });
      await mouse.up({ button, clickCount: count });
    }
  },
  wheel: (deltaX: number, deltaY: number) =>
    commands.mouseWheel(deltaX, deltaY),
};

// The center of `element` in client coordinates.
export function centerOf(element: Element) {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, box };
}
