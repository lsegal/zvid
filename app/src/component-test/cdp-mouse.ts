import { cdp } from "vitest/browser";

// A mouse driven through the Chrome DevTools Protocol, like Playwright's
// page.mouse: trusted pointer and mouse events with real hit testing, and
// presses held across moves for drags. Coordinates are viewport pixels.
// Chromium only.

export type Modifier = "Alt" | "Control" | "Meta" | "Shift";
type Button = "left" | "right";
type Point = { x: number; y: number };

const MODIFIER_BITS: Record<Modifier, number> = {
  Alt: 1,
  Control: 2,
  Meta: 4,
  Shift: 8,
};
const BUTTON_BITS: Record<Button, number> = { left: 1, right: 2 };

let position: Point = { x: 0, y: 0 };
let pressed: Button | null = null;

function modifierBits(modifiers: readonly Modifier[]) {
  return modifiers.reduce(
    (bits, modifier) => bits | MODIFIER_BITS[modifier],
    0,
  );
}

function send(params: Record<string, unknown>) {
  // vitest's CDPSession types `send` loosely; Playwright's session takes
  // any protocol method.
  const session = cdp() as unknown as {
    send: (method: string, params: Record<string, unknown>) => Promise<void>;
  };
  return session.send("Input.dispatchMouseEvent", params);
}

type Options = { modifiers?: readonly Modifier[] };

// Moves to (x, y) in `steps` even moves, with any held button.
export async function move(
  x: number,
  y: number,
  { steps = 1, modifiers = [] }: Options & { steps?: number } = {},
) {
  const from = position;
  for (let step = 1; step <= steps; step += 1) {
    position = {
      x: from.x + ((x - from.x) * step) / steps,
      y: from.y + ((y - from.y) * step) / steps,
    };
    await send({
      type: "mouseMoved",
      ...position,
      button: pressed ?? "none",
      buttons: pressed ? BUTTON_BITS[pressed] : 0,
      modifiers: modifierBits(modifiers),
    });
  }
}

export async function down({
  button = "left",
  modifiers = [],
  clickCount = 1,
}: Options & { button?: Button; clickCount?: number } = {}) {
  pressed = button;
  await send({
    type: "mousePressed",
    ...position,
    button,
    buttons: BUTTON_BITS[button],
    clickCount,
    modifiers: modifierBits(modifiers),
  });
}

export async function up({
  button = "left",
  modifiers = [],
  clickCount = 1,
}: Options & { button?: Button; clickCount?: number } = {}) {
  pressed = null;
  await send({
    type: "mouseReleased",
    ...position,
    button,
    buttons: 0,
    clickCount,
    modifiers: modifierBits(modifiers),
  });
}

// Presses and releases at (x, y). A right click opens the context menu, as
// a real one does.
export async function click(
  x: number,
  y: number,
  options: Options & { button?: Button } = {},
) {
  await move(x, y, options);
  await down(options);
  await up(options);
}

// The center of `element`'s box.
export function center(element: Element): Point {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}
