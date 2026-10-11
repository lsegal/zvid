import { cdp } from "vitest/browser";

// Trusted mouse input through the Chrome DevTools Protocol, like
// Playwright's `page.mouse`: drags with steps in between, held buttons and
// modifiers, and the wheel. Coordinates are the test page's client
// coordinates, offset by its frame's position in the runner. Chromium only.

type Button = "left" | "middle" | "right";
type Modifier = "Alt" | "Control" | "Meta" | "Shift";

const MODIFIER_BITS: Record<Modifier, number> = {
  Alt: 1,
  Control: 2,
  Meta: 4,
  Shift: 8,
};
const BUTTON_BITS: Record<Button, number> = { left: 1, right: 2, middle: 4 };

let position = { x: 0, y: 0 };
let buttons = 0;
let held: Button | "none" = "none";

function frameOffset() {
  const frame = window.frameElement?.getBoundingClientRect();
  return { x: frame?.left ?? 0, y: frame?.top ?? 0 };
}

function modifierBits(modifiers: readonly Modifier[] = []) {
  return modifiers.reduce((bits, modifier) => bits | MODIFIER_BITS[modifier], 0);
}

async function send(event: Record<string, unknown>) {
  const offset = frameOffset();
  const session = cdp() as unknown as {
    send: (method: string, params: object) => Promise<unknown>;
  };
  await session.send("Input.dispatchMouseEvent", {
    ...event,
    x: position.x + offset.x,
    y: position.y + offset.y,
  });
}

type Options = { modifiers?: readonly Modifier[] };

export const mouse = {
  async move(x: number, y: number, { steps = 1, modifiers }: Options & { steps?: number } = {}) {
    const from = position;
    for (let step = 1; step <= steps; step++) {
      position = {
        x: from.x + ((x - from.x) * step) / steps,
        y: from.y + ((y - from.y) * step) / steps,
      };
      await send({
        type: "mouseMoved",
        button: held,
        buttons,
        modifiers: modifierBits(modifiers),
      });
    }
  },
  async down({ button = "left", modifiers, clickCount = 1 }: Options & { button?: Button; clickCount?: number } = {}) {
    held = button;
    buttons |= BUTTON_BITS[button];
    await send({
      type: "mousePressed",
      button,
      buttons,
      clickCount,
      modifiers: modifierBits(modifiers),
    });
  },
  async up({ button = "left", modifiers, clickCount = 1 }: Options & { button?: Button; clickCount?: number } = {}) {
    buttons &= ~BUTTON_BITS[button];
    held = "none";
    await send({
      type: "mouseReleased",
      button,
      buttons,
      clickCount,
      modifiers: modifierBits(modifiers),
    });
  },
  async click(x: number, y: number, options: Options & { button?: Button; clickCount?: number } = {}) {
    await mouse.move(x, y, options);
    for (let count = 1; count <= (options.clickCount ?? 1); count++) {
      await mouse.down({ ...options, clickCount: count });
      await mouse.up({ ...options, clickCount: count });
    }
  },
  async wheel(deltaX: number, deltaY: number, options: Options = {}) {
    await send({
      type: "mouseWheel",
      deltaX,
      deltaY,
      modifiers: modifierBits(options.modifiers),
    });
  },
};

// The center of `element` in client coordinates.
export function centerOf(element: Element) {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, box };
}
