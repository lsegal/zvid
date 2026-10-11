import type { BrowserCommand } from "vitest/node";

// Playwright's mouse, for tests that drag with real pointer events. The
// test passes client coordinates inside the test iframe; these offset them
// by the iframe's position on the runner page.

type MouseButton = "left" | "right" | "middle";

async function frameOffset(context: Parameters<BrowserCommand>[0]) {
  const frame = await context.frame();
  const box = await (await frame.frameElement()).boundingBox();
  return { x: box?.x ?? 0, y: box?.y ?? 0 };
}

export const mouseMove: BrowserCommand<
  [x: number, y: number, steps?: number]
> = async (context, x, y, steps = 1) => {
  const offset = await frameOffset(context);
  await context.page.mouse.move(offset.x + x, offset.y + y, { steps });
};

// `clickCount` numbers the presses of a double or triple click.
export const mouseDown: BrowserCommand<
  [button?: MouseButton, clickCount?: number]
> = async (context, button = "left", clickCount = 1) => {
  await context.page.mouse.down({ button, clickCount });
};

export const mouseUp: BrowserCommand<
  [button?: MouseButton, clickCount?: number]
> = async (context, button = "left", clickCount = 1) => {
  await context.page.mouse.up({ button, clickCount });
};

export const mouseWheel: BrowserCommand<[dx: number, dy: number]> = async (
  context,
  dx,
  dy,
) => {
  await context.page.mouse.wheel(dx, dy);
};

declare module "vitest/browser" {
  interface BrowserCommands {
    mouseMove(x: number, y: number, steps?: number): Promise<void>;
    mouseDown(button?: MouseButton, clickCount?: number): Promise<void>;
    mouseUp(button?: MouseButton, clickCount?: number): Promise<void>;
    mouseWheel(dx: number, dy: number): Promise<void>;
  }
}
