import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { FX_PANEL_HEIGHT_STORAGE_KEY } from "../app/constants.ts";
import { renderApp } from "../component-test/app.tsx";
import { center, dblclick, drag, nextFrames } from "../component-test/input.ts";
import { setViewport } from "../component-test/viewport.ts";

// The FX panel's handle against the App layout it trades space with.

const query = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`No ${selector}`);
  }
  return element;
};
const height = (selector: string) =>
  query(selector).getBoundingClientRect().height;
const handle = () => query(".fx-panel-resize-handle");

describe("FX panel resizing", { timeout: 60_000 }, () => {
  test("dragging the top edge trades height with the editor panel", async () => {
    await setViewport({ width: 1280, height: 720 });
    await renderApp();
    const panelBefore = height(".fx-panel");
    const editorBefore = height(".editor-panel");

    const start = center(handle());
    await drag(start, { x: start.x, y: start.y - 60 });
    await expect
      .poll(() => height(".fx-panel"))
      .toBeCloseTo(panelBefore + 60, 0);
    expect(height(".editor-panel")).toBeCloseTo(editorBefore - 60, 0);
    expect(localStorage.getItem(FX_PANEL_HEIGHT_STORAGE_KEY)).toBe(
      String(Math.round(panelBefore + 60)),
    );
  });

  test("the panel stops short of the editor and stays in the window", async () => {
    await setViewport({ width: 1280, height: 720 });
    await renderApp();

    const start = center(handle());
    await drag(start, { x: start.x, y: 0 });
    await nextFrames();
    expect(height(".editor-panel")).toBeGreaterThanOrEqual(220);

    // A shorter window takes it down with it, without saving a new height.
    const saved = localStorage.getItem(FX_PANEL_HEIGHT_STORAGE_KEY);
    await setViewport({ width: 1280, height: 600 });
    await nextFrames();
    expect(height(".editor-panel")).toBeGreaterThanOrEqual(220);
    expect(
      query(".fx-panel").getBoundingClientRect().bottom,
    ).toBeLessThanOrEqual(query(".status-bar").getBoundingClientRect().top);
    expect(localStorage.getItem(FX_PANEL_HEIGHT_STORAGE_KEY)).toBe(saved);
  });

  test("the keyboard resizes it and a double-click fits the contents", async () => {
    await setViewport({ width: 1280, height: 720 });
    await renderApp();
    const fitted = height(".fx-panel");

    handle().focus();
    await userEvent.keyboard("{ArrowUp}");
    await expect.poll(() => height(".fx-panel")).toBeCloseTo(fitted + 16, 0);
    await userEvent.keyboard("{Home}");
    await expect.poll(() => height(".fx-panel")).toBe(120);

    const { x, y } = center(handle());
    await dblclick(x, y);
    await expect.poll(() => height(".fx-panel")).toBeCloseTo(fitted, 0);
    expect(localStorage.getItem(FX_PANEL_HEIGHT_STORAGE_KEY)).toBeNull();
  });

  test("a collapsed panel has no handle and only its header's height", async () => {
    await setViewport({ width: 1280, height: 720 });
    await renderApp();
    const start = center(handle());
    await drag(start, { x: start.x, y: start.y - 60 });

    query(".fx-panel__toggle").click();
    await expect
      .poll(() => document.querySelector(".fx-panel-resize-handle"))
      .toBeNull();
    expect(height(".fx-panel")).toBeLessThan(60);
  });

  test("cut-off content shows a scrollbar, even with overlay scrollbars", async () => {
    await setViewport({ width: 1280, height: 720 });
    await renderApp();
    const start = center(handle());
    await drag(start, { x: start.x, y: 10_000 });
    await expect.poll(() => height(".fx-panel")).toBe(120);

    const body = query(".fx-panel__body");
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    // Classic, so it takes room: an overlay scrollbar hides until a scroll.
    expect(body.offsetWidth - body.clientWidth).toBeGreaterThan(0);
  });
});
