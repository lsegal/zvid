import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { type Locator, page, userEvent } from "vitest/browser";
import { getShortcutLabels } from "../app/shortcut-labels.ts";
import {
  click,
  down,
  type Modifier,
  move,
  up,
} from "../component-test/cdp-mouse.ts";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
  sessionWithLayers,
  withTestPatternTrack,
} from "../component-test/editor-harness.tsx";
import { setViewport } from "../component-test/viewport.ts";
import { TimelineContextMenu } from "./TimelineContextMenu";

// Right-click menus on the editor's clips, lanes and source clips, in the
// editor harness that wires TimelineContextMenu and the timeline as App
// does. A four-second test pattern at 120 BPM spans eight quarters.

// Ctrl, or Cmd on macOS, like Playwright's ControlOrMeta.
const MOD: Modifier = getShortcutLabels().mac ? "Meta" : "Control";

function lane(id: string) {
  const element = document.querySelector<HTMLElement>(
    `[data-timeline-lane-id="${id}"]`,
  );
  if (!element) {
    throw new Error(`No layer ${id}`);
  }
  return element;
}

function element(selector: string) {
  const match = document.querySelector<HTMLElement>(selector);
  if (!match) {
    throw new Error(`Nothing matches ${selector}`);
  }
  return match;
}

function count(selector: string, root: ParentNode = document) {
  return root.querySelectorAll(selector).length;
}

function menu(name: string | RegExp) {
  return page.getByRole("menu", { name });
}

// Matches items whose name contains `name`, shortcut hints and all.
function menuItem(name: string) {
  return page.getByRole("menuitem", { name, exact: false });
}

function fxPanelTitle() {
  return document.querySelector(".fx-panel__toggle")?.textContent;
}

function nextFrames() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
}

// Scrolling closes an open menu, so bring the target into view (and let its
// scroll event fire) before right-clicking it, at `position` from its
// top-left corner or else its center.
async function rightClick(
  target: HTMLElement,
  position?: { x: number; y: number },
) {
  target.scrollIntoView({ block: "nearest", inline: "nearest" });
  await nextFrames();
  const box = target.getBoundingClientRect();
  await click(
    box.x + (position?.x ?? box.width / 2),
    box.y + (position?.y ?? box.height / 2),
    { button: "right" },
  );
}

function blurFocus() {
  (document.activeElement as HTMLElement | null)?.blur();
}

// Chromium turns Shift+F10 into a contextmenu event everywhere but macOS,
// where only the context-menu key does, so there it presses that instead.
const SHIFT_F10_OPENS_MENUS = !/mac/i.test(navigator.platform);

async function pressShiftF10() {
  await userEvent.keyboard(
    SHIFT_F10_OPENS_MENUS ? "{Shift>}{F10}{/Shift}" : "{ContextMenu}",
  );
}

async function expectHighlighted(item: Locator) {
  await expect.element(item).toHaveAttribute("data-highlighted", "");
}

function texts(locator: Locator) {
  return locator.elements().map((item) => item.textContent ?? "");
}

// Checks each item's text against a string, or a pattern for items that
// also show their shortcut.
function expectItems(locator: Locator, expected: (string | RegExp)[]) {
  const actual = texts(locator);
  expect(actual).toHaveLength(expected.length);
  expected.forEach((item, index) => {
    if (typeof item === "string") {
      expect(actual[index]).toBe(item);
    } else {
      expect(actual[index]).toMatch(item);
    }
  });
}

// Adds Layers 2 and 3 below Layer 1 from the header menu, as the e2e specs'
// addLayers does; the last one added is selected.
async function addLayers(count = 2) {
  for (let index = 1; index <= count; index += 1) {
    const headers = document.querySelectorAll<HTMLElement>(
      "[data-layer-header-id]",
    );
    await rightClick(headers[headers.length - 1]);
    await userEvent.click(
      page
        .getByRole("menu", { name: "Layer header actions" })
        .getByRole("menuitem", { name: "Insert layer below", exact: true }),
    );
    await expect
      .poll(() => document.querySelectorAll("[data-layer-header-id]").length)
      .toBe(index + 1);
  }
}

// A session with Layers 1 to 3, added as the e2e specs add them, and the
// test pattern in a source track when `withSource`.
async function openEditor({ withSource = false } = {}) {
  const session = sessionWithLayers(1);
  await renderEditor({
    project: withSource ? withTestPatternTrack(session) : session,
  });
  await expect.poll(() => count("[data-timeline-lane-id]")).toBe(1);
  await addLayers();
}

// Whether the browser would show its own menu for the last contextmenu
// event. Handlers stop it from bubbling, so keep the event from the capture
// phase and read it once they have all run.
let lastContextMenu: Event | undefined;
function trackContextMenu(event: Event) {
  lastContextMenu = event;
}

function lastEventShowedNativeMenu() {
  return lastContextMenu ? !lastContextMenu.defaultPrevented : undefined;
}

// Dispatches contextmenu on the first match of `selector` itself, as when
// the press starts on that element, and reports whether the native menu
// would have opened.
function contextMenuOn(selector: string) {
  const target = element(selector);
  const bounds = target.getBoundingClientRect();
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX: bounds.left + bounds.width / 2,
    clientY: bounds.top + bounds.height / 2,
  });
  target.dispatchEvent(event);
  return !event.defaultPrevented;
}

// Reports macOS, as Safari and Chrome on a Mac do, until the returned
// function restores the browser's own platform.
function reportMacOS() {
  const keys = ["platform", "userAgentData"] as const;
  const originals = keys.map((key) =>
    Object.getOwnPropertyDescriptor(Navigator.prototype, key),
  );
  Object.defineProperty(Navigator.prototype, "platform", {
    configurable: true,
    get: () => "MacIntel",
  });
  Object.defineProperty(Navigator.prototype, "userAgentData", {
    configurable: true,
    get: () => ({ platform: "macOS" }),
  });
  return () => {
    keys.forEach((key, index) => {
      const original = originals[index];
      if (original) {
        Object.defineProperty(Navigator.prototype, key, original);
      } else {
        delete (Navigator.prototype as unknown as Record<string, unknown>)[key];
      }
    });
  };
}

// Drags out an uncommitted selection on `target` between two x offsets from
// the song start, with the timeline scrolled back to it.
async function dragSelection(target: HTMLElement, fromX: number, toX: number) {
  // Centered, so the timeline's sticky header row doesn't cover the lane
  // when the FX panel leaves the timeline short.
  target.scrollIntoView({ block: "center" });
  element(".timeline-scroll").scrollLeft = 0;
  await nextFrames();
  const bounds = target.getBoundingClientRect();
  const y = bounds.y + 20;
  await move(bounds.x + fromX, y);
  await down();
  await move(bounds.x + toX, y, { steps: 4 });
  await up();
  await expect.poll(() => count(".timeline-selection", target)).toBe(1);
}

// Right-clicks the lane `x` from the song start where `dragSelection` left
// it, without scrolling, which would close the menu.
async function rightClickLaneAt(target: HTMLElement, x: number) {
  const bounds = target.getBoundingClientRect();
  await click(bounds.x + x, bounds.y + 20, { button: "right" });
}

describe(TimelineContextMenu, { timeout: EDITOR_TEST_TIMEOUT }, () => {
  let restorePlatform: (() => void) | undefined;

  beforeEach(async () => {
    // Tall enough for three layers and a source track without scrolling
    // the timeline, which closes menus.
    await setViewport({ width: 1600, height: 1200 });
    lastContextMenu = undefined;
    window.addEventListener("contextmenu", trackContextMenu, true);
  });

  afterEach(() => {
    window.removeEventListener("contextmenu", trackContextMenu, true);
    restorePlatform?.();
    restorePlatform = undefined;
  });

  test("right-clicking empty lane space selects the layer and offers only Paste", async () => {
    await openEditor();
    await rightClick(lane("2"), { x: 400, y: 20 });

    const layerMenu = menu("Layer actions");
    await expect.element(layerMenu).toBeVisible();
    expect(fxPanelTitle()).toBe("Layer 2 Effects");
    const items = layerMenu.getByRole("menuitem").elements();
    expect(items).toHaveLength(7);
    // Nothing is on the clipboard yet, so even Paste is disabled.
    for (const item of items) {
      expect(item.getAttribute("aria-disabled")).toBe("true");
    }

    await userEvent.keyboard("{Escape}");
    await expect.element(layerMenu).not.toBeInTheDocument();

    await rightClick(lane("3"), { x: 400, y: 20 });
    await expect.element(layerMenu).toBeVisible();
    await click(5, 5);
    await expect.element(layerMenu).not.toBeInTheDocument();

    // With nothing focused, Shift+F10 and the context-menu key open it on
    // the selected layer.
    blurFocus();
    await pressShiftF10();
    await expect.element(layerMenu).toBeVisible();
    expect(fxPanelTitle()).toBe("Layer 3 Effects");
    await userEvent.keyboard("{Escape}");
    await expect.element(layerMenu).not.toBeInTheDocument();
    await userEvent.keyboard("{ContextMenu}");
    await expect.element(layerMenu).toBeVisible();
  });

  test("source clip menu copies to a chosen layer, and clip menu pastes at the playhead on the selected layer", async () => {
    await openEditor({ withSource: true });

    // Copy to layer ▸ Layer 1 through the keyboard: → opens the submenu.
    await rightClick(element(".source-span"));
    const spanMenu = menu("Source clip actions");
    await expect.element(spanMenu).toBeVisible();
    // Copy to layer is the last item, after the clip items.
    await userEvent.keyboard("{End}");
    await expectHighlighted(menuItem("Copy to layer"));
    await userEvent.keyboard("{ArrowRight}");
    const submenu = menu("Copy to layer");
    await expect.element(submenu).toBeVisible();
    expectItems(submenu.getByRole("menuitem"), [
      /^Auto \(last free layer\)(Ctrl|Cmd)\+click$/,
      "Layer 1",
      "Layer 2",
      "Layer 3",
      "New layer",
    ]);
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    await expect.element(spanMenu).not.toBeInTheDocument();
    await expect.poll(() => count(".clip-card", lane("1"))).toBe(1);

    // A specific layer overrides Auto: Layer 1 again, even though it
    // overlaps.
    await rightClick(element(".source-span"));
    await userEvent.hover(menuItem("Copy to layer"));
    await userEvent.click(menuItem("Layer 1"));
    await expect.element(spanMenu).not.toBeInTheDocument();
    expect(count(".clip-card", lane("1"))).toBe(1);
    expect(count(".clip-card")).toBe(1);

    // Auto takes the last free layer, as Ctrl/Cmd-click does.
    await rightClick(element(".source-span"));
    await userEvent.hover(menuItem("Copy to layer"));
    await userEvent.click(menuItem("Auto (last free layer)"));
    await expect.poll(() => count(".clip-card", lane("3"))).toBe(1);

    // Right-clicking a clip selects it; Copy, then Paste on another layer.
    const clip = element('[data-timeline-lane-id="1"] .clip-card');
    await rightClick(clip);
    const clipMenu = menu("Clip actions");
    await expect.element(clipMenu).toBeVisible();
    await expect.poll(() => clip.className).toMatch(/clip-card--selected/);
    await expect
      .element(menuItem("Split at playhead"))
      .toHaveAttribute("aria-disabled", "true");
    await userEvent.click(menuItem("Copy"));
    await expect.element(clipMenu).not.toBeInTheDocument();

    await rightClick(lane("2"), { x: 400, y: 20 });
    await expect
      .element(menuItem("Paste"))
      .not.toHaveAttribute("aria-disabled", "true");
    await userEvent.click(menuItem("Paste"));
    await expect.poll(() => count(".clip-card", lane("2"))).toBe(1);
    const pasted = element('[data-timeline-lane-id="2"] .clip-card');
    expect(pasted.className).toMatch(/clip-card--selected/);
    // The playhead sits at the start, so the paste lands there too.
    expect(getComputedStyle(pasted).left).toBe("0px");

    // Shift+F10 opens the menu on the selected clip; End reaches Delete.
    blurFocus();
    await pressShiftF10();
    await expect.element(clipMenu).toBeVisible();
    // The menu takes focus a tick after it opens; keys before that are lost.
    await expect
      .poll(() => document.activeElement?.getAttribute("aria-label"))
      .toBe("Clip actions");
    await userEvent.keyboard("{End}");
    await expectHighlighted(menuItem("Delete"));
    await userEvent.keyboard("{Enter}");
    await expect.element(clipMenu).not.toBeInTheDocument();
    await expect.poll(() => count(".clip-card", lane("2"))).toBe(0);
  });

  test("the FX device menu runs on the shared context menu", async () => {
    await renderEditor();
    await expect.poll(() => count("[data-timeline-lane-id]")).toBe(1);
    await rightClick(lane("1"), { x: 400, y: 20 });
    await userEvent.keyboard("{Escape}");

    const title = element("[data-fx-focus]");
    await rightClick(title);
    const deviceMenu = menu(/actions$/);
    await expect.element(deviceMenu).toBeVisible();
    await userEvent.keyboard("{ArrowDown}");
    await expectHighlighted(menuItem("Collapse"));
    await userEvent.keyboard("{Enter}");
    await expect.element(deviceMenu).not.toBeInTheDocument();
    await rightClick(element("[data-fx-focus]"));
    await expect.element(menuItem("Expand")).toBeVisible();
  });

  test("right-clicks on clips, lanes and source clips, even on their thumbnails, never open the browser menu", async () => {
    await openEditor({ withSource: true });
    await userEvent.click(page.elementLocator(element(".source-span")), {
      modifiers: [MOD],
    });
    await expect.poll(() => count(".clip-card", lane("3"))).toBe(1);
    await expect.poll(() => count(".clip-card__tile")).toBeGreaterThan(0);
    await expect.poll(() => count(".source-span__tile")).toBeGreaterThan(0);

    const clipMenu = menu("Clip actions");
    const laneMenu = menu("Layer actions");
    const spanMenu = menu("Source clip actions");

    // Real right-clicks.
    for (const [selector, targetMenu] of [
      ['[data-timeline-lane-id="3"] .clip-card', clipMenu],
      [".source-span", spanMenu],
    ] as const) {
      await rightClick(element(selector));
      await expect.element(targetMenu).toBeVisible();
      expect(lastEventShowedNativeMenu()).toBe(false);
      await userEvent.keyboard("{Escape}");
      await expect.element(targetMenu).not.toBeInTheDocument();
    }
    await rightClick(lane("2"), { x: 400, y: 20 });
    await expect.element(laneMenu).toBeVisible();
    expect(lastEventShowedNativeMenu()).toBe(false);
    await userEvent.keyboard("{Escape}");

    // Presses that start on a clip's children, including images and video,
    // where browsers otherwise offer their image and video menus.
    for (const parent of document.querySelectorAll(
      ".clip-card, .source-span",
    )) {
      const image = document.createElement("img");
      image.className = "test-image";
      const video = document.createElement("video");
      video.className = "test-video";
      parent.append(image, video);
    }
    for (const [owner, ownerMenu] of [
      [".clip-card", clipMenu],
      [".source-span", spanMenu],
    ] as const) {
      const prefix = owner.slice(1);
      for (const child of [
        `.${prefix}__filmstrip`,
        `.${prefix}__tile`,
        `.${prefix}__body`,
        `${owner} .test-image`,
        `${owner} .test-video`,
      ]) {
        if (!count(child)) {
          continue;
        }
        expect(contextMenuOn(child), child).toBe(false);
        await expect.element(ownerMenu).toBeVisible();
        await userEvent.keyboard("{Escape}");
        await expect.element(ownerMenu).not.toBeInTheDocument();
      }
    }
    // Every clip has at least its filmstrip, body, image and video checked.
    expect(count(".clip-card__filmstrip")).toBe(1);
    expect(count(".source-span__filmstrip")).toBe(1);

    // Elsewhere the browser keeps its own menu.
    expect(contextMenuOn(".topbar")).toBe(true);
    expect(page.getByRole("menu").elements()).toHaveLength(0);
  });

  test("Ctrl-click on macOS opens the menus without selecting, dragging or dropping", async () => {
    // Report macOS so the editor treats Ctrl-click as a context-menu press.
    restorePlatform = reportMacOS();
    await openEditor({ withSource: true });
    await userEvent.click(page.elementLocator(element(".source-span")), {
      modifiers: ["Meta"],
    });
    await expect.poll(() => count(".clip-card")).toBe(1);

    // macOS sends a primary-button press with Ctrl, then contextmenu.
    async function ctrlClick(target: HTMLElement, position = { x: 20, y: 20 }) {
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
      await nextFrames();
      const bounds = target.getBoundingClientRect();
      const x = bounds.x + position.x;
      const y = bounds.y + position.y;
      await userEvent.keyboard("{Control>}");
      await move(x, y, { modifiers: ["Control"] });
      await down({ modifiers: ["Control"] });
      target.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 0,
          ctrlKey: true,
          clientX: x,
          clientY: y,
        }),
      );
      await up({ modifiers: ["Control"] });
      await userEvent.keyboard("{/Control}");
    }

    await ctrlClick(lane("2"), { x: 400, y: 20 });
    await expect.element(menu("Layer actions")).toBeVisible();
    expect(lastEventShowedNativeMenu()).toBe(false);
    expect(count(".timeline-selection")).toBe(0);
    await userEvent.keyboard("{Escape}");

    // The lane press scrolled the timeline, leaving the clip under the
    // sticky layer labels, so scroll back before pressing it.
    element(".timeline-scroll").scrollLeft = 0;
    await ctrlClick(element(".clip-card .clip-card__body"));
    await expect.element(menu("Clip actions")).toBeVisible();
    expect(lastEventShowedNativeMenu()).toBe(false);
    expect(count(".clip-card")).toBe(1);
    expect(element(".clip-card").className).toMatch(/clip-card--selected/);
    await userEvent.keyboard("{Escape}");

    // Cmd-click drops a source clip on macOS; Ctrl-click only opens its
    // menu.
    await ctrlClick(element(".source-span"));
    await expect.element(menu("Source clip actions")).toBeVisible();
    expect(lastEventShowedNativeMenu()).toBe(false);
    expect(count(".clip-card")).toBe(1);
  });

  test("right-clicking a selection keeps it and inserts a track like its number key", async () => {
    await openEditor({ withSource: true });
    const trackName = "test-pattern";

    // The number key commits the same range on Layer 2, for comparison.
    await dragSelection(lane("2"), 30, 130);
    await userEvent.keyboard("1");
    await expect.poll(() => count(".clip-card", lane("2"))).toBe(1);
    const keyed = element('[data-timeline-lane-id="2"] .clip-card');

    await dragSelection(lane("1"), 30, 130);
    const selectionBox = element(
      '[data-timeline-lane-id="1"] .timeline-selection',
    ).getBoundingClientRect();
    await rightClickLaneAt(lane("1"), 80);
    const selectionMenu = menu("Selection actions");
    await expect.element(selectionMenu).toBeVisible();
    expect(count(".timeline-selection", lane("1"))).toBe(1);
    expectItems(selectionMenu.getByRole("menuitem"), [
      /^Cut/,
      /^Copy/,
      /^Delete/,
      "Insert Track",
      "Insert Fill Clip",
      "Insert Text Clip",
      "Insert FX Clip",
      "Clear selectionEsc",
    ]);

    await userEvent.hover(menuItem("Insert Track"));
    const submenu = menu("Insert Track");
    await expect.element(submenu).toBeVisible();
    expectItems(submenu.getByRole("menuitem"), [`${trackName}1`]);
    await userEvent.click(
      submenu.getByRole("menuitem", { name: trackName, exact: false }),
    );
    await expect.element(selectionMenu).not.toBeInTheDocument();
    expect(count(".timeline-selection")).toBe(0);

    await expect.poll(() => count(".clip-card", lane("1"))).toBe(1);
    const inserted = element('[data-timeline-lane-id="1"] .clip-card');
    expect(inserted.className).toMatch(/clip-card--selected/);
    const insertedBox = inserted.getBoundingClientRect();
    const keyedBox = keyed.getBoundingClientRect();
    expect(insertedBox.x).toBeCloseTo(keyedBox.x, 0);
    expect(insertedBox.width).toBeCloseTo(keyedBox.width, 0);
    expect(insertedBox.x).toBeCloseTo(selectionBox.x, 0);

    // Insert Fill Clip fills exactly the selected range and selects the fill.
    await dragSelection(lane("3"), 30, 130);
    const fillSelectionBox = element(
      '[data-timeline-lane-id="3"] .timeline-selection',
    ).getBoundingClientRect();
    await rightClickLaneAt(lane("3"), 80);
    await userEvent.click(menuItem("Insert Fill Clip"));
    await expect.element(selectionMenu).not.toBeInTheDocument();
    expect(count(".timeline-selection")).toBe(0);
    await expect.poll(() => count(".clip-card--fill", lane("3"))).toBe(1);
    const fill = element('[data-timeline-lane-id="3"] .clip-card--fill');
    expect(fill.className).toMatch(/clip-card--selected/);
    const fillBox = fill.getBoundingClientRect();
    expect(fillBox.x).toBeCloseTo(fillSelectionBox.x, 0);
    expect(fillBox.width).toBeCloseTo(fillSelectionBox.width, 0);

    // Past the end of the footage, the track is disabled.
    await dragSelection(lane("3"), 600, 700);
    await rightClickLaneAt(lane("3"), 650);
    await userEvent.hover(menuItem("Insert Track"));
    const noFootage = menu("Insert Track").getByRole("menuitem", {
      name: trackName,
      exact: false,
    });
    await expect.element(noFootage).toHaveAttribute("aria-disabled", "true");
    await expect.element(noFootage).toHaveAttribute("title", "No footage here");

    // Clear selection is the Escape equivalent.
    await userEvent.keyboard("{Escape}");
    await userEvent.click(menuItem("Clear selection"));
    await expect.poll(() => count(".timeline-selection")).toBe(0);

    // Right-clicking outside the selection opens the lane menu and clears
    // it.
    await dragSelection(lane("3"), 600, 700);
    await rightClickLaneAt(lane("3"), 300);
    await expect.element(menu("Layer actions")).toBeVisible();
    expect(count(".timeline-selection")).toBe(0);
    await userEvent.keyboard("{Escape}");

    // With nothing focused, Shift+F10 opens the selection menu on it.
    await dragSelection(lane("3"), 600, 700);
    blurFocus();
    await pressShiftF10();
    await expect.element(selectionMenu).toBeVisible();
    expect(count(".timeline-selection", lane("3"))).toBe(1);
  });
});
