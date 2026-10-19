/// <reference types="@vitest/browser-playwright" />

import { expect, onTestFinished } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { getShortcutLabels } from "../app/shortcut-labels.ts";

// Trusted mouse, touch and key input for component tests, sent through the
// Chrome DevTools Protocol like Playwright's page.mouse: the browser hit
// tests, captures pointers and fires click, dblclick and contextmenu
// itself. The mouse remembers where it is and which buttons are down, so
// presses hold across moves for drags. Coordinates are the test page's
// client coordinates, as getBoundingClientRect gives them. Chromium only.

export type MouseButton = "left" | "middle" | "right";
export type Modifier = "Alt" | "Control" | "Meta" | "Shift";
type Point = { x: number; y: number };
type PressOptions = {
  button?: MouseButton;
  // The modifier keys the event carries; by default, those holdModifiers
  // holds.
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
let resetScheduled = false;

function modifierBits(modifiers: readonly Modifier[] = held) {
  return modifiers.reduce((bits, key) => bits | MODIFIER_BITS[key], 0);
}

function heldButton() {
  const button = (Object.keys(BUTTON_BITS) as MouseButton[]).find(
    (name) => pressed & BUTTON_BITS[name],
  );
  return button ?? "none";
}

// The test page is an iframe of the runner's page, which CDP input
// addresses; this maps a point in the test page into the runner's page.
function toTop({ x, y }: Point) {
  const frame = window.frameElement;
  if (!frame) {
    return { x, y };
  }
  const bounds = frame.getBoundingClientRect();
  const scale = bounds.width / window.innerWidth || 1;
  return { x: bounds.left + x * scale, y: bounds.top + y * scale };
}

// Releases what a test leaves down, even one that fails mid-drag, once it
// ends.
function resetAfterTest() {
  if (!resetScheduled) {
    resetScheduled = true;
    onTestFinished(resetMouse);
  }
}

// A mouse event at the mouse's position.
function sendMouse(params: {
  type: "mouseMoved" | "mousePressed" | "mouseReleased";
  button: MouseButton | "none";
  buttons: number;
  clickCount?: number;
  modifiers: number;
}) {
  return cdp().send("Input.dispatchMouseEvent", {
    ...params,
    ...toTop(position),
  });
}

// The modifier keys the mouse events that follow carry, as when a key is
// held through a drag; press the key itself on the keyboard too.
export function holdModifiers(modifiers: readonly Modifier[]) {
  resetAfterTest();
  held = modifiers;
}

// Moves to (x, y) in `steps` even moves. The moves report the buttons held
// down, as pointer capture needs.
export async function move(
  x: number,
  y: number,
  {
    steps = 1,
    modifiers,
  }: { steps?: number; modifiers?: readonly Modifier[] } = {},
) {
  const from = position;
  for (let step = 1; step <= steps; step++) {
    position = {
      x: from.x + ((x - from.x) * step) / steps,
      y: from.y + ((y - from.y) * step) / steps,
    };
    await sendMouse({
      type: "mouseMoved",
      // Chromium takes the held button from `button`, not `buttons`.
      button: heldButton(),
      buttons: pressed,
      modifiers: modifierBits(modifiers),
    });
  }
}

export async function down({
  button = "left",
  modifiers,
  clickCount = 1,
}: PressOptions = {}) {
  resetAfterTest();
  pressed |= BUTTON_BITS[button];
  await sendMouse({
    type: "mousePressed",
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
  await sendMouse({
    type: "mouseReleased",
    button,
    buttons: pressed,
    clickCount,
    modifiers: modifierBits(modifiers),
  });
}

// Presses and releases at (x, y). A right click opens the context menu, as
// a real one does.
export async function click(x: number, y: number, options: PressOptions = {}) {
  await move(x, y, options);
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

// Presses at (x, y) and keeps the button down for `ms`, still pressed when
// it returns; release with up().
export async function pressAndHold(
  x: number,
  y: number,
  ms: number,
  options: PressOptions = {},
) {
  await move(x, y, options);
  await down(options);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Clicks at (x, y) and reports whether the press lasted less than `ms`, an
// upper bound on the time between the page's pointerdown and pointerup.
export async function quickClick(
  x: number,
  y: number,
  ms: number,
  options: PressOptions = {},
) {
  await move(x, y, options);
  const start = performance.now();
  await down(options);
  await up(options);
  return performance.now() - start < ms;
}

// Presses at `from`, moves to `to` in `steps` and releases there.
export async function drag(
  from: Point,
  to: Point,
  { steps = 10, ...options }: PressOptions & { steps?: number } = {},
) {
  await move(from.x, from.y, options);
  await down(options);
  await move(to.x, to.y, { ...options, steps });
  await up(options);
}

// Releases the buttons left down and drops held modifiers; runs after every
// test that pressed.
export async function resetMouse() {
  resetScheduled = false;
  for (const button of ["left", "middle", "right"] as const) {
    if (pressed & BUTTON_BITS[button]) {
      await up({ button, modifiers: [] });
    }
  }
  held = [];
}

// Sends a touch: "touchEnd" lifts every finger.
export async function touch(
  type: "touchStart" | "touchMove" | "touchEnd",
  x: number,
  y: number,
) {
  await cdp().send("Input.dispatchTouchEvent", {
    type,
    touchPoints: type === "touchEnd" ? [] : [toTop({ x, y })],
  });
}

// The center of an element, in client coordinates.
export function center(element: Element): Point {
  const box = element.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Waits for two frames, for layout and effects to settle.
export function nextFrames() {
  return new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

// Whether an element is visible, as Playwright's toBeVisible checks it.
export function isVisible(element: Element | null) {
  return Boolean(
    element &&
      (element as HTMLElement).checkVisibility({
        visibilityProperty: true,
        opacityProperty: false,
      }) &&
      element.getBoundingClientRect().width > 0 &&
      element.getBoundingClientRect().height > 0,
  );
}

// Keys.

// Presses `key` with Ctrl, or Cmd on macOS, as "ControlOrMeta+key" does.
export async function pressMod(key: string, { shift = false } = {}) {
  const mod = getShortcutLabels().mac ? "Meta" : "Control";
  await userEvent.keyboard(
    `{${mod}>}${shift ? "{Shift>}" : ""}${key}${shift ? "{/Shift}" : ""}{/${mod}}`,
  );
}

export const undo = () => pressMod("z");
export const redo = () => pressMod("z", { shift: true });

// Presses Shift+F10 on the focused element. Chromium turns it into a
// contextmenu event there on Linux and Windows but not on macOS, so there
// the test sends the event Chromium would.
export async function pressShiftF10() {
  let opened = false;
  const onContextMenu = () => {
    opened = true;
  };
  document.addEventListener("contextmenu", onContextMenu, true);
  try {
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await nextFrames();
    const focused = document.activeElement;
    if (!opened && focused instanceof HTMLElement) {
      const bounds = focused.getBoundingClientRect();
      focused.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: bounds.left,
          clientY: bounds.bottom,
        }),
      );
    }
  } finally {
    document.removeEventListener("contextmenu", onContextMenu, true);
  }
}

// Menus.

// Right-clicks an element's center, scrolled into view.
export async function rightClick(element: Element) {
  element.scrollIntoView({ block: "nearest" });
  await nextFrames();
  const point = center(element);
  await click(point.x, point.y, { button: "right" });
}

export function menuItem(name: string) {
  return page.getByRole("menuitem", { name, exact: true });
}

// A layer's header, by its id.
export function layerHeader(id: string) {
  return document.querySelector(
    `[data-layer-header-id="${id}"]`,
  ) as HTMLElement;
}

// Opens a layer header's menu.
export async function openLayerMenu(id: string) {
  await rightClick(layerHeader(id));
  const menu = page.getByRole("menu", { name: "Layer header actions" });
  await expect.element(menu).toBeVisible();
  return menu;
}

// A new session starts with one layer, Layer 1 ("1"). Tests that need more
// insert them below it from its header menu: Layer 2 is "2" and Layer 3 is
// "3".
export async function addLayers(count = 2) {
  const headers = () => document.querySelectorAll("[data-layer-header-id]");
  await expect.poll(headers).toHaveLength(1);
  for (let index = 1; index <= count; index += 1) {
    const last = headers()[headers().length - 1];
    await openLayerMenu(last.getAttribute("data-layer-header-id") ?? "");
    await page
      .getByRole("menu", { name: "Layer header actions" })
      .getByRole("menuitem", { name: "Insert layer below", exact: true })
      .click();
    await expect.poll(headers).toHaveLength(index + 1);
  }
  expect(layerHeader(`${count + 1}`)).toBeTruthy();
}
