import { describe, expect, test } from "vitest";
import { type Locator, page, userEvent } from "vitest/browser";
import { getShortcutLabels } from "../app/shortcut-labels.ts";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
  sessionWithLayers,
  withTestPatternTrack,
} from "../component-test/editor-harness.tsx";
import { TopBar } from "./TopBar";

// The top-bar Edit menu mirrors the clip, layer and Audio row right-click
// menus under Edit ▸ Clip, Edit ▸ Layer and Edit ▸ Audio, in the editor
// harness that wires TopBar to the timeline as App does.

const MOD = getShortcutLabels().mac ? "Meta" : "Control";

function lane(id: string) {
  return document.querySelector<HTMLElement>(`[data-timeline-lane-id="${id}"]`);
}

function texts(locator: Locator) {
  return locator.elements().map((element) => element.textContent ?? "");
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

async function openEditMenu() {
  await userEvent.click(
    page.getByRole("menuitem", { name: "Edit", exact: true }),
  );
  const menu = page.getByRole("menu").first();
  await expect.element(menu).toBeVisible();
  return menu;
}

// Hovers a submenu trigger and returns the submenu it opens.
async function openSubmenu(name: string | RegExp) {
  await userEvent.hover(page.getByRole("menuitem", { name }));
  const submenu = page.getByRole("menu").nth(1);
  await expect.element(submenu).toBeVisible();
  return submenu;
}

// Adds Layers 2 and 3 below Layer 1 from the header menu, as the e2e specs'
// addLayers does.
async function addLayers(count = 2) {
  for (let index = 1; index <= count; index += 1) {
    const headers = document.querySelectorAll<HTMLElement>(
      "[data-layer-header-id]",
    );
    await userEvent.click(page.elementLocator(headers[headers.length - 1]), {
      button: "right",
    });
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

function layerIndex(name: string) {
  const header = [
    ...document.querySelectorAll<HTMLElement>(".track-label--lane"),
  ].find((label) => label.textContent?.includes(name));
  const index = header?.querySelector<HTMLElement>(".track-label__index");
  if (!index) {
    throw new Error(`No ${name} header`);
  }
  return page.elementLocator(index);
}

describe(TopBar, { timeout: EDITOR_TEST_TIMEOUT }, () => {
  test("Edit shows Clip and Layer only for a selection, and Audio always", async () => {
    await renderEditor();
    await expect.poll(() => lane("1")).toBeTruthy();
    const menu = await openEditMenu();
    expectItems(menu.getByRole("menuitem"), [
      /^Undo/,
      /^Redo/,
      /^Cut/,
      /^Copy/,
      /^Paste/,
      "Audio",
    ]);
    for (const name of ["Cut", "Copy", "Paste"]) {
      await expect
        .element(page.getByRole("menuitem", { name: new RegExp(`^${name}`) }))
        .toHaveAttribute("aria-disabled", "true");
    }

    const audio = await openSubmenu("Audio");
    expectItems(audio.getByRole("menuitem"), ["Recompute audio"]);
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");

    // Inserting a layer selects it, so Layers 2 and 3 are only added now.
    // Clicking a layer header selects the layer.
    await addLayers();
    await userEvent.click(layerIndex("Layer 2"));
    await openEditMenu();
    const layer = await openSubmenu("Layer: Layer 2");
    expectItems(layer.getByRole("menuitem"), [
      "Rename…",
      "Duplicate",
      "Delete",
      /^(Enable|Disable) FX$/,
      "Add FX",
      "Insert text at playhead",
      "Insert FX clip at playhead",
      "Insert layer above",
      "Insert layer below",
      "Move up",
      "Move down",
    ]);
    expect(
      page.getByRole("menuitem", { name: /^Clip:/ }).elements(),
    ).toHaveLength(0);

    // Same action as the header's right-click menu: a new layer above.
    await userEvent.click(
      page.getByRole("menuitem", { name: "Insert layer above" }),
    );
    await expect
      .poll(() =>
        [...document.querySelectorAll(".track-label--lane")].some((label) =>
          label.textContent?.includes("Layer 4"),
        ),
      )
      .toBe(true);
  });

  test("Edit ▸ Clip runs the clip actions on the selected clip", async () => {
    await renderEditor({
      project: withTestPatternTrack(sessionWithLayers(1)),
    });
    await expect
      .poll(() => document.querySelectorAll(".source-span").length)
      .toBe(1);
    await addLayers();
    await userEvent.click(
      page.elementLocator(
        document.querySelector(".source-span") as HTMLElement,
      ),
      { modifiers: [MOD] },
    );
    const clipCount = () => document.querySelectorAll(".clip-card").length;
    await expect.poll(clipCount).toBe(1);
    const clip = document.querySelector(".clip-card") as HTMLElement;
    await userEvent.click(page.elementLocator(clip));
    await expect.poll(() => clip.className).toMatch(/clip-card--selected/);

    await openEditMenu();
    const clipMenu = await openSubmenu(/^Clip: /);
    expectItems(clipMenu.getByRole("menuitem"), [
      /^Jump to start/,
      /^Duplicate/,
      /^Split at playhead/,
      /^Delete/,
    ]);
    await expect
      .element(page.getByRole("menuitem", { name: /^Split at playhead/ }))
      .toHaveAttribute("aria-disabled", "true");
    await expect
      .element(page.getByRole("menuitem", { name: /^Layer: / }))
      .toBeVisible();

    await userEvent.click(page.getByRole("menuitem", { name: /^Duplicate/ }));
    await expect.poll(clipCount).toBe(2);

    // Copy, then Paste at the playhead on the selected layer.
    await openEditMenu();
    await userEvent.click(page.getByRole("menuitem", { name: /^Copy/ }));
    await userEvent.click(layerIndex("Layer 2"));
    await openEditMenu();
    expect(
      page.getByRole("menuitem", { name: /^Clip: / }).elements(),
    ).toHaveLength(0);
    await userEvent.click(page.getByRole("menuitem", { name: /^Paste/ }));
    const pasted = () => lane("2")?.querySelectorAll(".clip-card") ?? [];
    await expect.poll(() => pasted().length).toBe(1);
    expect(pasted()[0].className).toMatch(/clip-card--selected/);

    await openEditMenu();
    await openSubmenu(/^Clip: /);
    await userEvent.click(page.getByRole("menuitem", { name: /^Delete/ }));
    await expect.poll(() => pasted().length).toBe(0);
  });
});
