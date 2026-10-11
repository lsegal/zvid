import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { TimelineHarness } from "../components/timeline/timeline-harness";
import {
  addLayers,
  layerHeader,
  menuItem,
  openLayerMenu,
  pressShiftF10,
  undo,
} from "../components/timeline/timeline-harness-input";
// The menu these tests open; importing it ties them to it.
import "./layer-menu.ts";

// Right-click menus on layer headers, in the timeline with the editing hooks
// the app wires them to. Layers: "1" is Layer 1, and addLayers adds "2"
// (Layer 2) and "3" (Layer 3).

function texts(selector: string) {
  return () =>
    [...document.querySelectorAll(selector)].map((node) => node.textContent);
}

const names = texts("[data-layer-header-id] .track-label__select > span");
const numbers = texts("[data-layer-header-id] .track-label__index");

function fxPanelTitle() {
  return document.querySelector(".fx-panel__toggle")?.textContent;
}

const layerMenu = () => page.getByRole("menu", { name: "Layer header actions" });

describe("layer header menu", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<TimelineHarness />);
    await expect.poll(() => layerHeader("1")).toBeTruthy();
    await addLayers();
  });

  test("Insert text at playhead adds a text clip on the layer", async () => {
    await openLayerMenu("2");
    await menuItem("Insert text at playhead").click();
    const text = () =>
      document.querySelectorAll('[data-timeline-lane-id="2"] .clip-card--text');
    await expect.poll(text).toHaveLength(1);
    await expect.poll(() => text()[0].className).toMatch(/clip-card--selected/);
    await expect
      .element(page.getByRole("region", { name: "Text", exact: true }))
      .toBeVisible();
  });

  test("right-clicking a layer header selects it and lists the layer actions", async () => {
    await openLayerMenu("2");
    await expect.poll(fxPanelTitle).toBe("Layer 2 Effects");
    const items = layerMenu().getByRole("menuitem").elements();
    expect(items.map((item) => item.textContent)).toEqual([
      "Rename…",
      "Duplicate",
      "Delete",
      expect.stringMatching(/^(Enable|Disable) FX$/),
      "Add FX",
      "Insert text at playhead",
      "Insert FX clip at playhead",
      "Insert layer above",
      "Insert layer below",
      "Move up",
      "Move down",
    ]);
    await userEvent.keyboard("{Escape}");
    await expect.element(layerMenu()).not.toBeInTheDocument();

    // The top layer cannot move up, the bottom one cannot move down.
    await openLayerMenu("1");
    await expect
      .element(menuItem("Move up"))
      .toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{Escape}");
    await openLayerMenu("3");
    await expect
      .element(menuItem("Move down"))
      .toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{Escape}");
    await expect.element(layerMenu()).not.toBeInTheDocument();

    // Shift+F10 on the focused layer header opens the same menu.
    (
      layerHeader("3").querySelector(".track-label__select") as HTMLElement
    ).focus();
    await pressShiftF10();
    await expect.element(layerMenu()).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(layerMenu()).not.toBeInTheDocument();
  });

  test("layer actions reorder, insert, duplicate, rename and delete, each undoable", async () => {
    expect(names()).toEqual(["Layer 1", "Layer 2", "Layer 3"]);

    // Move up: the numbers follow the new order.
    await openLayerMenu("2");
    await menuItem("Move up").click();
    await expect.poll(names).toEqual(["Layer 2", "Layer 1", "Layer 3"]);
    expect(numbers()).toEqual(["1", "2", "3"]);
    await undo();
    await expect.poll(names).toEqual(["Layer 1", "Layer 2", "Layer 3"]);

    await openLayerMenu("2");
    await menuItem("Insert layer above").click();
    await expect
      .poll(names)
      .toEqual(["Layer 1", "Layer 4", "Layer 2", "Layer 3"]);
    await undo();
    await expect.poll(names).toEqual(["Layer 1", "Layer 2", "Layer 3"]);

    await openLayerMenu("2");
    await menuItem("Duplicate").click();
    await expect
      .poll(names)
      .toEqual(["Layer 1", "Layer 2", "Layer 2 copy", "Layer 3"]);
    await undo();
    await expect.poll(names).toEqual(["Layer 1", "Layer 2", "Layer 3"]);

    // Rename: Escape cancels, Enter saves.
    await openLayerMenu("2");
    await menuItem("Rename…").click();
    const input = page.getByRole("textbox", { name: "Layer name" });
    await expect.element(input).toHaveFocus();
    await input.fill("Ignored");
    await userEvent.keyboard("{Escape}");
    await expect.poll(names).toEqual(["Layer 1", "Layer 2", "Layer 3"]);
    await openLayerMenu("2");
    await menuItem("Rename…").click();
    await expect.element(input).toHaveFocus();
    await input.fill("Drums");
    await userEvent.keyboard("{Enter}");
    await expect.poll(names).toEqual(["Layer 1", "Drums", "Layer 3"]);
    await undo();
    await expect.poll(names).toEqual(["Layer 1", "Layer 2", "Layer 3"]);

    await openLayerMenu("1");
    await menuItem("Delete").click();
    await expect.poll(names).toEqual(["Layer 2", "Layer 3"]);
    await undo();
    await expect.poll(names).toEqual(["Layer 1", "Layer 2", "Layer 3"]);
  });

  test("Add FX adds to the layer and the FX toggle follows it", async () => {
    await openLayerMenu("3");
    await menuItem("Add FX").hover();
    const submenu = page.getByRole("menu", { name: "Add FX" });
    await expect.element(submenu).toBeVisible();
    const first = submenu.getByRole("menuitem").first();
    const effectName = first.element().textContent ?? "";
    await first.click();
    await expect.element(submenu).not.toBeInTheDocument();
    await expect.poll(fxPanelTitle).toBe("Layer 3 Effects");
    await expect
      .poll(() => document.querySelector(".fx-panel")?.textContent)
      .toContain(effectName);

    await openLayerMenu("3");
    await menuItem("Disable FX").click();
    await openLayerMenu("3");
    await expect.element(menuItem("Enable FX")).toBeVisible();
  });
});
