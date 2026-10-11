import { expect } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import audioVideoUrl from "../../e2e/fixtures/test-pattern-audio.webm?url";
import videoUrl from "../../e2e/fixtures/test-pattern.mp4?url";
import toneUrl from "../../e2e/fixtures/tone.wav?url";
import AppRoot from "../AppRoot.tsx";
import { installHarness } from "../harness";
import { clearCurrentSession } from "../workspace-store.ts";
import "./commands.ts";

// Renders the whole editor for tests whose behavior crosses App-level state:
// undo history, global shortcuts, context menus and selection shared between
// the timeline, the FX panel and the arrangement. These tests import App, so
// `vitest --changed` selects them for any change under it; prefer rendering
// the component itself when a test only needs its rendering and styles.

// Starts from a blank session, as a fresh Playwright page does: the saved
// session and stored preferences of the previous test are cleared first.
export async function renderApp() {
  await clearCurrentSession();
  localStorage.clear();
  sessionStorage.clear();
  await installHarness();
  const screen = await render(<AppRoot />);
  await expect
    .poll(() => document.querySelector("[data-timeline-lane-id]"))
    .toBeTruthy();
  return screen;
}

export const FIXTURES = {
  "test-pattern.mp4": { url: videoUrl, type: "video/mp4" },
  "test-pattern-audio.webm": { url: audioVideoUrl, type: "video/webm" },
  "tone.wav": { url: toneUrl, type: "audio/wav" },
} as const;

export type FixtureName = keyof typeof FIXTURES;

// A File holding one of the e2e media fixtures, as a drop from the desktop
// delivers it.
export async function fixtureFile(name: FixtureName, fileName: string = name) {
  const { url, type } = FIXTURES[name];
  const bytes = await (await fetch(url)).arrayBuffer();
  return new File([bytes], fileName, { type });
}

export function fileTransfer(files: readonly File[]) {
  const transfer = new DataTransfer();
  for (const file of files) {
    transfer.items.add(file);
  }
  return transfer;
}

type DragInit = Pick<DragEventInit, "clientX" | "clientY" | "shiftKey">;

export function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

// Dispatches drag events carrying `transfer` at `target`, the way
// Playwright's dispatchEvent does in the e2e specs, waiting a frame after
// each so React renders the drag state in between as it does there.
export async function dispatchDrag(
  target: Element,
  types: readonly string[],
  transfer: DataTransfer,
  init: DragInit = {},
) {
  for (const type of types) {
    target.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: transfer,
        ...init,
      }),
    );
    await nextFrame();
  }
}

export function dropFiles(
  target: Element,
  transfer: DataTransfer,
  init: DragInit = {},
) {
  return dispatchDrag(target, ["dragenter", "dragover", "drop"], transfer, init);
}

export function query<T extends Element = HTMLElement>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`missing ${selector}`);
  }
  return element;
}

export function queryAll<T extends Element = HTMLElement>(selector: string) {
  return [...document.querySelectorAll<T>(selector)];
}

// Waits for `selector` to match `count` elements; media imports take a
// while to probe the dropped file.
export async function expectCount(
  selector: string,
  count: number,
  timeout = 30_000,
) {
  await expect
    .poll(() => document.querySelectorAll(selector).length, { timeout })
    .toBe(count);
}

// Drops the fixture on the source track header, which adds a new track
// holding its clip, and waits for the clip.
export async function dropOnSourceHeader(
  files: readonly File[],
  expectedSpans = files.length,
) {
  await dropFiles(
    query('[aria-label="Source track drop area"]'),
    fileTransfer(files),
  );
  await expectCount(".source-span", expectedSpans);
}

function center(element: Element) {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

// Real pointer input through Playwright's mouse; coordinates are client
// coordinates in the test page.
export const mouse = {
  move: (x: number, y: number, steps = 1) => commands.mouseMove(x, y, steps),
  down: (button?: "left" | "right" | "middle") => commands.mouseDown(button),
  up: (button?: "left" | "right" | "middle") => commands.mouseUp(button),
  wheel: (dx: number, dy: number) => commands.mouseWheel(dx, dy),
  async moveTo(element: Element, steps = 1) {
    const { x, y } = center(element);
    await commands.mouseMove(x, y, steps);
  },
};

// A new session starts with one layer, Layer 1 ("1"). Inserts `count` more
// below it from its header menu: Layer 2 is "2" and Layer 3 is "3".
export async function addLayers(count = 2) {
  const headers = () => queryAll("[data-layer-header-id]");
  expect(headers()).toHaveLength(1);
  for (let index = 1; index <= count; index += 1) {
    const last = headers().at(-1) as HTMLElement;
    last.scrollIntoView({ block: "nearest" });
    await userEvent.click(last, { button: "right" });
    await page
      .getByRole("menu", { name: "Layer header actions" })
      .getByRole("menuitem", { name: "Insert layer below", exact: true })
      .click();
    await expect.poll(() => headers().length).toBe(index + 1);
  }
}
