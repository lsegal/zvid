import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { emulateTouch } from "../../component-test/viewport.ts";
import { TimelineHarness } from "./timeline-harness";
import {
  addLayers,
  center,
  layerHeader,
  menuItem,
  mouse,
  nextFrames,
  openLayerMenu,
  touch,
  undo,
} from "./timeline-harness-input";
import { LayerHeader } from "./LayerHeader";

// A layer's header (LayerHeader) in the timeline: its reorder grip and its
// FX switch. Layers: "1" is Layer 1, and addLayers adds "2" (Layer 2) and
// "3" (Layer 3).

function grip(id: string) {
  return document.querySelector(`[data-layer-grip="${id}"]`) as HTMLElement;
}

function texts(selector: string) {
  return () =>
    [...document.querySelectorAll(selector)].map((node) => node.textContent);
}

const names = texts("[data-layer-header-id] .track-label__select > span");
const numbers = texts("[data-layer-header-id] .track-label__index");

function status() {
  return document.querySelector(".layer-reorder-status")?.textContent;
}

function fxPanelTitle() {
  return document.querySelector(".fx-panel__toggle")?.textContent;
}

function lifted() {
  return document.querySelectorAll(".track-row--lifted");
}

function fxSwitch(id: string) {
  return layerHeader(id).querySelector(".track-label__fx") as HTMLButtonElement;
}

// Scrolls `element` into view, if it isn't, and returns its center.
async function centerInView(element: Element) {
  element.scrollIntoView({ block: "nearest" });
  await nextFrames();
  return center(element);
}

// Adds Layer 4 below Layer 3, with a text clip and an effect of its own.
async function addLayer4() {
  await openLayerMenu("3");
  await menuItem("Insert layer below").click();
  await expect
    .poll(names)
    .toEqual(["Layer 1", "Layer 2", "Layer 3", "Layer 4"]);
  const id =
    document
      .querySelectorAll("[data-layer-header-id]")[3]
      .getAttribute("data-layer-header-id") ?? "";

  await openLayerMenu(id);
  await menuItem("Insert text at playhead").click();
  await expect
    .poll(() =>
      document.querySelectorAll(
        `[data-timeline-lane-id="${id}"] .clip-card--text`,
      ),
    )
    .toHaveLength(1);

  await openLayerMenu(id);
  await menuItem("Add FX").hover();
  const submenu = page.getByRole("menu", { name: "Add FX" });
  await submenu.getByRole("menuitem").first().click();
  await expect.element(submenu).not.toBeInTheDocument();
  expect(fxSwitch(id).disabled).toBe(false);
  return id;
}

describe(LayerHeader, { timeout: 60_000 }, () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<TimelineHarness />);
    await expect.poll(() => layerHeader("1")).toBeTruthy();
    await addLayers();
  });

  // Reordering layers from the grip left of each header's number (#478).
  describe("reorder grip", () => {
    test("each layer header has a grip left of its number", async () => {
      for (const id of ["1", "2", "3"]) {
        const handle = grip(id).getBoundingClientRect();
        const number = (
          layerHeader(id).querySelector(".track-label__index") as HTMLElement
        ).getBoundingClientRect();
        expect(handle.x + handle.width).toBeLessThanOrEqual(number.x);
      }
      expect(grip("2").getAttribute("aria-label")).toBe("Reorder Layer 2");
    });

    test("dragging Layer 4 above Layer 1 carries its clips and effects, in one undo step", async () => {
      const id = await addLayer4();
      const from = await centerInView(grip(id));
      const ruler = (
        document.querySelector(".ruler-row") as HTMLElement
      ).getBoundingClientRect();

      await mouse.move(from.x, from.y);
      await mouse.down();
      await mouse.move(from.x, from.y - 10, { steps: 2 });
      const row = () =>
        document.querySelector(`[data-layer-row-id="${id}"]`) as HTMLElement;
      await expect.poll(() => row().className).toMatch(/track-row--lifted/);
      // Up past Layer 1, scrolling the list as it goes.
      await mouse.move(from.x, ruler.y + ruler.height + 4, { steps: 12 });
      await expect.poll(status).toBe("Layer 4, position 1 of 4");
      await expect
        .element(page.elementLocator(document.querySelector(".layer-drop-indicator") as HTMLElement))
        .toBeVisible();
      await mouse.up();

      await expect
        .poll(names)
        .toEqual(["Layer 4", "Layer 1", "Layer 2", "Layer 3"]);
      expect(numbers()).toEqual(["1", "2", "3", "4"]);
      await expect.poll(() => row().className).not.toMatch(/track-row--lifted/);
      // Same layer id, so its clip and effects came with it; it stays
      // selected.
      expect(
        document.querySelectorAll(
          `[data-timeline-lane-id="${id}"] .clip-card--text`,
        ),
      ).toHaveLength(1);
      expect(fxSwitch(id).disabled).toBe(false);
      await expect.poll(fxPanelTitle).toBe("Layer 4 Effects");

      await undo();
      await expect
        .poll(names)
        .toEqual(["Layer 1", "Layer 2", "Layer 3", "Layer 4"]);
      expect(
        document.querySelectorAll(
          `[data-timeline-lane-id="${id}"] .clip-card--text`,
        ),
      ).toHaveLength(1);
    });

    test("holding a drag near the top edge scrolls, and Escape cancels it", async () => {
      const scroller = document.querySelector(
        ".timeline-scroll",
      ) as HTMLElement;
      const from = await centerInView(grip("3"));
      expect(scroller.scrollTop).toBeGreaterThan(0);
      const ruler = (
        document.querySelector(".ruler-row") as HTMLElement
      ).getBoundingClientRect();

      await mouse.move(from.x, from.y);
      await mouse.down();
      // Just below the sticky ruler: the list scrolls up under the pointer.
      await mouse.move(from.x, ruler.y + ruler.height + 4, { steps: 10 });
      await expect.poll(status).toBe("Layer 3, position 1 of 3");
      await expect.poll(() => scroller.scrollTop).toBe(0);
      await userEvent.keyboard("{Escape}");
      await expect.poll(status).toBe("Canceled moving Layer 3");
      await mouse.up();
      expect(names()).toEqual(["Layer 1", "Layer 2", "Layer 3"]);
      await expect.poll(lifted).toHaveLength(0);
      await expect
        .element(page.elementLocator(document.querySelector(".layer-drop-indicator") as HTMLElement))
        .not.toBeVisible();
    });

    test("the keyboard picks a layer up, moves it and drops it", async () => {
      grip("3").focus();
      await userEvent.keyboard("{Enter}");
      await expect.poll(status).toContain("Picked up Layer 3, position 3 of 3");
      expect(grip("3").getAttribute("aria-pressed")).toBe("true");
      await expect
        .poll(
          () =>
            (document.querySelector('[data-layer-row-id="3"]') as HTMLElement)
              .className,
        )
        .toMatch(/track-row--lifted/);
      await userEvent.keyboard("{ArrowUp}");
      await expect.poll(status).toBe("Layer 3, position 2 of 3");
      await userEvent.keyboard("{ArrowUp}");
      await expect.poll(status).toBe("Layer 3, position 1 of 3");
      // Still in place until dropped.
      expect(names()).toEqual(["Layer 1", "Layer 2", "Layer 3"]);
      await userEvent.keyboard("{Enter}");
      await expect.poll(status).toBe("Dropped Layer 3, position 1 of 3");
      await expect.poll(names).toEqual(["Layer 3", "Layer 1", "Layer 2"]);
      await expect.poll(() => document.activeElement).toBe(grip("3"));
      expect(grip("3").getAttribute("aria-pressed")).toBe("false");
      await expect.poll(fxPanelTitle).toBe("Layer 3 Effects");

      // Escape puts it back where it was.
      await userEvent.keyboard("{Enter}");
      await userEvent.keyboard("{ArrowDown}");
      await userEvent.keyboard("{Escape}");
      await expect.poll(status).toBe("Canceled moving Layer 3");
      expect(names()).toEqual(["Layer 3", "Layer 1", "Layer 2"]);

      await undo();
      await expect.poll(names).toEqual(["Layer 1", "Layer 2", "Layer 3"]);
    });

    test("clicking the header outside the grip still selects the layer", async () => {
      await page
        .elementLocator(
          layerHeader("3").querySelector(".track-label__index") as HTMLElement,
        )
        .click();
      await expect.poll(fxPanelTitle).toBe("Layer 3 Effects");
      // A click on the grip without dragging selects too, and moves nothing.
      const point = await centerInView(grip("2"));
      await mouse.click(point.x, point.y);
      await expect.poll(fxPanelTitle).toBe("Layer 2 Effects");
      expect(names()).toEqual(["Layer 1", "Layer 2", "Layer 3"]);
      expect(lifted()).toHaveLength(0);
    });

    test("on a touch screen, a long press on the grip picks the layer up", async () => {
      await emulateTouch();
      const from = await centerInView(grip("2"));
      const row = (
        document.querySelector('[data-layer-row-id="2"]') as HTMLElement
      ).getBoundingClientRect();

      // A quick touch that moves off is not a drag.
      await touch("touchStart", from.x, from.y);
      await touch("touchMove", from.x, from.y + 30);
      await touch("touchEnd", from.x, from.y + 30);
      expect(lifted()).toHaveLength(0);

      await touch("touchStart", from.x, from.y);
      await expect
        .poll(
          () =>
            (document.querySelector('[data-layer-row-id="2"]') as HTMLElement)
              .className,
        )
        .toMatch(/track-row--lifted/);
      for (let step = 1; step <= 8; step += 1) {
        await touch("touchMove", from.x, from.y + (row.height * step) / 8 + 4);
      }
      await expect.poll(status).toBe("Layer 2, position 3 of 3");
      await touch("touchEnd", from.x, from.y + row.height + 4);
      await expect.poll(names).toEqual(["Layer 1", "Layer 3", "Layer 2"]);
    });
  });

  // The FX button in each layer header (#693): always toggleable and lit
  // while the layer's FX are on.
  describe("FX switch", () => {
    test("every layer's FX button is enabled and lit by default", () => {
      for (const id of ["1", "2", "3"]) {
        expect(fxSwitch(id).disabled).toBe(false);
        expect(fxSwitch(id).getAttribute("aria-pressed")).toBe("true");
      }
    });

    // The FX switch is plain text (#721): amber while on, muted while off,
    // with no chip, border or background either way.
    test("a layer's FX button is plain text, amber when on and muted when off", async () => {
      const fx = fxSwitch("1");
      await mouse.move(0, 0);
      expect(fx.getAttribute("aria-pressed")).toBe("true");
      let style = getComputedStyle(fx);
      expect(style.color).toBe("rgb(246, 183, 60)");
      expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(style.borderTopWidth).toBe("0px");

      await page.elementLocator(fx).click();
      await mouse.move(0, 0);
      await expect.poll(() => fx.getAttribute("aria-pressed")).toBe("false");
      style = getComputedStyle(fx);
      await expect.poll(() => style.color).toBe("rgb(164, 169, 191)");
      expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(style.borderTopWidth).toBe("0px");
    });
  });
});
