import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { TEXT_CLIP_BARS } from "../../app/constants.ts";
import {
  chainStatus,
  nextFrames,
  stackDevice,
  stackDevices,
  stackUnit,
  undo,
  withLayers,
} from "../../component-test/fx-chain.ts";
import { FxEditor } from "../../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  withEffect,
  withTextClip,
} from "../../component-test/fx-projects.ts";
import { centerOf, mouse } from "../../component-test/mouse.ts";
import { setViewport } from "../../component-test/viewport.ts";

// FX devices move between the Global, Layer and Clip stacks by dragging
// their title bar, from the keyboard and from their context menu, but only
// onto stacks their effect is designed for. A clip's content device stays at
// the front of the Clip stack.

const count = (group: string, name: string) => stackDevices(group, name).length;

// A new text clip on Layer 2, selected, so the chain reads
// GLOBAL [Order] | LAYER [Layout, ...] | CLIP [Text], with the effects named
// on the layer.
async function openTextClip(effects: string[]) {
  let project = withLayers(EMPTY_PROJECT, 1);
  for (const effect of effects) {
    project = withEffect(project, "2", effect).project;
  }
  const added = withTextClip(project, {
    laneId: "2",
    durationQ: TEXT_CLIP_BARS * 4,
  });
  await render(
    <FxEditor project={added.project} selection={{ clipId: added.clip.id }} />,
  );
  for (const effect of effects) {
    await expect.poll(() => count("layer", effect)).toBe(1);
  }
  await expect.poll(() => count("clip", "Text")).toBe(1);

  // Fold the devices so every stack fits in view.
  for (const name of ["Order", "Layout", "Text", ...effects]) {
    const title = document.querySelector(
      `.fx-chain section[aria-label="${name}"] .fx-device-panel__title`,
    );
    if (!title) {
      throw new Error(`No ${name} title bar`);
    }
    await userEvent.dblClick(page.elementLocator(title), {
      position: { x: 4, y: 4 },
    });
  }
  await expect
    .poll(() => document.querySelectorAll(".fx-device-panel--collapsed").length)
    .toBe(3 + effects.length);
}

// Presses on `from` and moves to `to`, then reports whether the insertion
// marker showed before letting go.
async function drag(from: Element, to: { x: number; y: number }) {
  const start = centerOf(from);
  await mouse.move(start.x, start.y);
  await mouse.down();
  await mouse.move(to.x, to.y, { steps: 12 });
  // Let the marker render.
  await nextFrames();
  const marker = document.querySelectorAll(".fx-chain__marker").length;
  await mouse.up();
  return marker > 0;
}

// Just right of a panel, inside its stack.
function rightOf(element: Element) {
  const box = element.getBoundingClientRect();
  return { x: box.right + 2, y: box.top + box.height / 2 };
}

describe("FX cross-stack moves", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    // A fresh page, as each e2e test had: no folded devices.
    localStorage.clear();
    await setViewport({ width: 1920, height: 1080 });
  });

  test("dragging a device moves it to another stack and undo restores it", async () => {
    await openTextClip(["Colorize"]);

    // Layer → Clip, after the clip's Text.
    expect(
      await drag(
        stackDevice("layer", "Colorize"),
        rightOf(stackUnit("clip", "Text")),
      ),
    ).toBe(true);
    await expect.poll(() => count("clip", "Colorize")).toBe(1);
    expect(count("layer", "Colorize")).toBe(0);
    await expect
      .poll(chainStatus)
      .toBe("Moved Colorize to position 2 of 2 in Clip");

    // Clip → Global, after the Order.
    expect(
      await drag(
        stackDevice("clip", "Colorize"),
        rightOf(stackUnit("global", "Order")),
      ),
    ).toBe(true);
    await expect.poll(() => count("global", "Colorize")).toBe(1);
    expect(count("clip", "Colorize")).toBe(0);

    // Each move is one undo step.
    await undo();
    await expect.poll(() => count("clip", "Colorize")).toBe(1);
    await undo();
    await expect.poll(() => count("layer", "Colorize")).toBe(1);
  });

  test("a device can't be dropped on a stack it isn't designed for, or ahead of the clip's Text", async () => {
    await openTextClip(["Transform", "Colorize"]);
    const order = () => stackUnit("global", "Order");
    const text = () => stackDevice("clip", "Text");

    // Transform never goes on the Global stack.
    expect(
      await drag(stackDevice("layer", "Transform"), rightOf(order())),
    ).toBe(false);
    await nextFrames();
    expect(count("layer", "Transform")).toBe(1);
    expect(count("global", "Transform")).toBe(0);

    // Nothing goes ahead of the clip's Text.
    const textBox = text().getBoundingClientRect();
    expect(
      await drag(stackDevice("layer", "Colorize"), {
        x: textBox.left + 2,
        y: textBox.top + 10,
      }),
    ).toBe(false);
    await nextFrames();
    expect(count("layer", "Colorize")).toBe(1);

    // The Text itself doesn't drag.
    expect(await drag(text(), rightOf(order()))).toBe(false);
    await nextFrames();
    expect(count("clip", "Text")).toBe(1);
    expect(
      document.querySelectorAll(".fx-chain [data-fx-group='clip']"),
    ).toHaveLength(1);
  });

  test("the keyboard and context menu move a device to another stack", async () => {
    await openTextClip(["Transform"]);

    // Alt+Shift+Right sends the layer's Transform to the start of the Clip
    // stack, after the Text.
    page
      .elementLocator(stackDevice("layer", "Transform"))
      .getByRole("button", { name: "Expand Transform" })
      .element()
      .focus();
    await userEvent.keyboard("{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}");
    await expect.poll(() => count("clip", "Transform")).toBe(1);
    await expect
      .poll(chainStatus)
      .toBe("Moved Transform to position 2 of 2 in Clip");

    // Transform can't go on the Global stack, so its menu won't offer it.
    await userEvent.click(
      page.elementLocator(stackDevice("clip", "Transform")),
      {
        button: "right",
      },
    );
    const menu = page.getByRole("menu", { name: "Transform actions" });
    await userEvent.hover(
      menu.getByRole("menuitem", { name: "Move", exact: true }),
    );
    const move = page.getByRole("menu", { name: "Move" });
    await expect
      .element(move.getByRole("menuitem", { name: "to Global" }))
      .toBeDisabled();
    await userEvent.click(move.getByRole("menuitem", { name: "to Layer" }));
    await expect.poll(() => count("layer", "Transform")).toBe(1);
    await expect
      .poll(chainStatus)
      .toBe("Moved Transform to position 2 of 2 in Layer 2");

    // The Text has no move actions.
    await userEvent.click(page.elementLocator(stackDevice("clip", "Text")), {
      button: "right",
    });
    const textMenu = page.getByRole("menu", { name: "Text actions" });
    await userEvent.hover(
      textMenu.getByRole("menuitem", { name: "Move", exact: true }),
    );
    for (const name of ["Left", "Right", "to Global", "to Layer", "to Clip"]) {
      // Left and Right carry their shortcut in the name.
      await expect
        .element(move.getByRole("menuitem", { name: new RegExp(`^${name}`) }))
        .toBeDisabled();
    }
  });
});
