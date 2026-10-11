import { cdp } from "vitest/browser";

// The timeline tests' mouse: trusted input through the Chrome DevTools
// Protocol, with real hit testing, like Playwright's page.mouse. It
// remembers where it is and which buttons are down, moves in steps, and
// presses any button. Coordinates are the test page's client coordinates,
// as getBoundingClientRect gives them. Chromium only.

export type MouseButton = "left" | "middle" | "right";
export type Modifier = "Alt" | "Control" | "Meta" | "Shift";

type Point = { x: number; y: number };
type PressOptions = {
  button?: MouseButton;
  modifiers?: readonly Modifier[];
  clickCount?: number;
};

const BUTTON_BITS: Record<MouseButton, number> = {
  left: 1,
  right: 2,
  middle: 4,
};
const MODIFIER_BITS: Record<Modifier, number> = {
  Alt: 1,
  Control: 2,
  Meta: 4,
  Shift: 8,
};

let position: Point = { x: 0, y: 0 };
let pressed = 0;
let held: readonly Modifier[] = [];

function modifierBits(modifiers: readonly Modifier[] = held) {
  return modifiers.reduce((bits, key) => bits | MODIFIER_BITS[key], 0);
}

function send(params: Record<string, unknown>) {
  const session = cdp() as unknown as {
    send: (method: string, params: Record<string, unknown>) => Promise<void>;
  };
  return session.send("Input.dispatchMouseEvent", params);
}

// The modifier keys the mouse events that follow carry, as when a key is
// held through a drag; press the key itself on the keyboard too.
export function holdModifiers(modifiers: readonly Modifier[]) {
  held = modifiers;
}

export async function move(x: number, y: number, { steps = 1 } = {}) {
  const from = position;
  for (let step = 1; step <= steps; step++) {
    position = {
      x: from.x + ((x - from.x) * step) / steps,
      y: from.y + ((y - from.y) * step) / steps,
    };
    await send({
      type: "mouseMoved",
      ...position,
      buttons: pressed,
      modifiers: modifierBits(),
    });
  }
}

export async function down({
  button = "left",
  modifiers,
  clickCount = 1,
}: PressOptions = {}) {
  pressed |= BUTTON_BITS[button];
  await send({
    type: "mousePressed",
    ...position,
    button,
    buttons: pressed,
    clickCount,
    modifiers: modifierBits(modifiers),
  });
}

export async function up({
  button = "left",
  modifiers,
  clickCount = 1,
}: PressOptions = {}) {
  pressed &= ~BUTTON_BITS[button];
  await send({
    type: "mouseReleased",
    ...position,
    button,
    buttons: pressed,
    clickCount,
    modifiers: modifierBits(modifiers),
  });
}

export async function click(x: number, y: number, options: PressOptions = {}) {
  await move(x, y);
  await down(options);
  await up(options);
}

export async function dblclick(
  x: number,
  y: number,
  options: PressOptions = {},
) {
  await click(x, y, options);
  await down({ ...options, clickCount: 2 });
  await up({ ...options, clickCount: 2 });
}

// Presses at `from`, moves to `to` in `steps` and releases there.
export async function drag(
  from: Point,
  to: Point,
  { steps = 10, ...options }: PressOptions & { steps?: number } = {},
) {
  await move(from.x, from.y);
  await down(options);
  await move(to.x, to.y, { steps });
  await up(options);
}

// Releases the buttons a failed test left down and drops held modifiers.
export async function resetMouse() {
  for (const button of ["left", "middle", "right"] as const) {
    if (pressed & BUTTON_BITS[button]) {
      await up({ button });
    }
  }
  held = [];
}

// The center of an element, in client coordinates.
export function center(element: Element): Point {
  const box = element.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
