import { cdp, userEvent } from "vitest/browser";
import { getShortcutLabels } from "../../app/shortcut-labels.ts";

// Trusted pointer, touch and key input for component tests, sent through
// the Chrome DevTools Protocol like Playwright's page.mouse, so the browser
// hit tests, captures and fires click and dblclick itself. Coordinates are
// the test page's client coordinates.

type Session = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
};

function session() {
  return cdp() as unknown as Session;
}

// The test page is an iframe of the runner's page, which CDP input
// addresses; this maps a point in the test page into the runner's page.
function toTop(x: number, y: number) {
  const frame = window.frameElement;
  if (!frame) {
    return { x, y };
  }
  const bounds = frame.getBoundingClientRect();
  const scale = bounds.width / window.innerWidth || 1;
  return { x: bounds.left + x * scale, y: bounds.top + y * scale };
}

type Button = "left" | "right" | "none";
type Modifiers = { shift?: boolean };

let pointer = { x: 0, y: 0 };
let pressed: Button = "none";

function modifierBits(modifiers?: Modifiers) {
  return modifiers?.shift ? 8 : 0;
}

async function mouseEvent(
  type: "mouseMoved" | "mousePressed" | "mouseReleased",
  x: number,
  y: number,
  button: Button,
  clickCount = 0,
  modifiers?: Modifiers,
) {
  const point = toTop(x, y);
  await session().send("Input.dispatchMouseEvent", {
    type,
    x: point.x,
    y: point.y,
    button,
    buttons: pressed === "left" ? 1 : pressed === "right" ? 2 : 0,
    clickCount,
    modifiers: modifierBits(modifiers),
  });
}

export const mouse = {
  async move(x: number, y: number, { steps = 1, ...modifiers } = {} as {
    steps?: number;
  } & Modifiers) {
    const from = pointer;
    for (let step = 1; step <= steps; step += 1) {
      await mouseEvent(
        "mouseMoved",
        from.x + ((x - from.x) * step) / steps,
        from.y + ((y - from.y) * step) / steps,
        pressed,
        0,
        modifiers,
      );
    }
    pointer = { x, y };
  },
  async down(
    { button = "left", clickCount = 1, ...modifiers } = {} as {
      button?: Button;
      clickCount?: number;
    } & Modifiers,
  ) {
    pressed = button;
    await mouseEvent(
      "mousePressed",
      pointer.x,
      pointer.y,
      button,
      clickCount,
      modifiers,
    );
  },
  async up(
    { button = "left", clickCount = 1, ...modifiers } = {} as {
      button?: Button;
      clickCount?: number;
    } & Modifiers,
  ) {
    pressed = "none";
    await mouseEvent(
      "mouseReleased",
      pointer.x,
      pointer.y,
      button,
      clickCount,
      modifiers,
    );
  },
  async click(x: number, y: number, { button = "left" as Button } = {}) {
    await this.move(x, y);
    await this.down({ button });
    await this.up({ button });
  },
  async dblclick(x: number, y: number) {
    await this.move(x, y);
    await this.down({ clickCount: 1 });
    await this.up({ clickCount: 1 });
    await this.down({ clickCount: 2 });
    await this.up({ clickCount: 2 });
  },
};

// Sends a touch: "touchEnd" lifts every finger.
export async function touch(
  type: "touchStart" | "touchMove" | "touchEnd",
  x: number,
  y: number,
) {
  const point = toTop(x, y);
  await session().send("Input.dispatchTouchEvent", {
    type,
    touchPoints: type === "touchEnd" ? [] : [point],
  });
}

// The center of an element, in client coordinates.
export function center(element: Element) {
  const bounds = element.getBoundingClientRect();
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

// Waits for two frames, for layout and effects to settle.
export function nextFrames() {
  return new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

// Presses `key` with Ctrl, or Cmd on macOS, as "ControlOrMeta+key" does.
export async function pressMod(key: string, { shift = false } = {}) {
  const mod = getShortcutLabels().mac ? "Meta" : "Control";
  await userEvent.keyboard(
    `{${mod}>}${shift ? "{Shift>}" : ""}${key}${shift ? "{/Shift}" : ""}{/${mod}}`,
  );
}

export const undo = () => pressMod("z");
export const redo = () => pressMod("z", { shift: true });
