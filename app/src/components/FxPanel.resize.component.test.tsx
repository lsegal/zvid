import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
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

// The MIDI sample's Arp clip, whose Clip and Notes regions lead the chain.
async function openMidiClip() {
  await userEvent.click(
    page.getByRole("menuitem", { name: "File", exact: true }),
  );
  await userEvent.click(
    page.getByRole("menuitem", { name: "Open", exact: true }),
  );
  await userEvent.click(
    page.getByRole("menuitem", { name: "Samples", exact: true }),
  );
  await userEvent.click(
    page.getByRole("menuitem", { name: "MIDI", exact: true }),
  );
  const clip = () =>
    [...document.querySelectorAll<HTMLElement>("[data-source-span-id]")].find(
      (span) => span.textContent?.startsWith("Arp"),
    );
  await expect.poll(clip, { timeout: 30_000 }).toBeTruthy();
  await userEvent.click(clip() as HTMLElement);
  await expect.poll(() => document.querySelector(".piano-roll")).not.toBeNull();
}

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
    await drag(start, { x: start.x, y: innerHeight - 1 });
    await expect.poll(() => height(".fx-panel")).toBe(120);

    const body = query(".fx-panel__body");
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    // Either standard property would leave macOS's overlay scrollbar, hidden
    // until a scroll, in place of the app's ::-webkit-scrollbar styles. (The
    // width itself is 0 where Playwright hides scrollbars, as headless does.)
    const style = getComputedStyle(body);
    expect(style.scrollbarWidth).toBe("auto");
    expect(style.scrollbarColor).toBe("auto");
    expect(getComputedStyle(body, "::-webkit-scrollbar").width).toBe("10px");
  });

  test("the Clip and Notes regions render into the panel's height", async () => {
    await setViewport({ width: 1389, height: 800 });
    await renderApp();
    await openMidiClip();
    handle().focus();

    // Taller than the chain's devices: nothing scrolls, and the regions end
    // at the chain's bottom edge with no dead space under their contents.
    await userEvent.keyboard("{End}");
    await nextFrames();
    const body = query(".fx-panel__body");
    expect(body.scrollHeight).toBe(body.clientHeight);
    const bottom = (selector: string) =>
      query(selector).getBoundingClientRect().bottom;
    const tallRoll = height(".piano-roll__scroll");
    expect(bottom(".piano-roll__scroll")).toBeCloseTo(
      bottom(".piano-roll") - 11,
      0,
    );
    // Above the chain's bottom padding, and its scrollbar where those take room.
    const chain = query(".fx-chain");
    expect(bottom(".piano-roll")).toBeCloseTo(
      chain.getBoundingClientRect().top + chain.clientHeight - 16,
      0,
    );
    // The Clip frame fills the height too, but its fields stay packed at the
    // top rather than stretching down to its bottom edge.
    const fields = document.querySelectorAll<HTMLElement>(
      ".source-clip-properties__fields > *",
    );
    expect(bottom(".source-clip-properties")).toBeCloseTo(
      bottom(".piano-roll"),
      0,
    );
    expect(
      fields[1].getBoundingClientRect().top -
        fields[0].getBoundingClientRect().bottom,
    ).toBeCloseTo(8, 0);

    // Shorter, the roll gives up height before the body starts to scroll.
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await nextFrames();
    expect(height(".piano-roll__scroll")).toBeCloseTo(tallRoll - 32, 0);
    expect(body.scrollHeight).toBe(body.clientHeight);
  });
});
