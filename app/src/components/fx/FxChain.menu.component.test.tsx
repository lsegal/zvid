import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { TEXT_CLIP_BARS } from "../../app/constants.ts";
import {
  chainStatus,
  stackDevice,
  stackDevices,
  undo,
} from "../../component-test/fx-chain.ts";
import { FxEditor } from "../../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  withEffect,
  withTextClip,
} from "../../component-test/fx-projects.ts";

// The device menus' Cut, Copy, Move to another stack, and the stacks' own
// menus with Paste and Clear All. Each action is one undo step.

const count = (group: string, name: string) => stackDevices(group, name).length;

async function openDeviceMenu(group: string, name: string) {
  const title = stackDevice(group, name).querySelector(
    ".fx-device-panel__title",
  );
  if (!title) {
    throw new Error(`No ${name} title bar`);
  }
  await userEvent.click(page.elementLocator(title), { button: "right" });
  return page.getByRole("menu", { name: `${name} actions` });
}

async function openStackMenu(addLabel: string, stack: string) {
  await userEvent.click(page.getByRole("button", { name: addLabel }), {
    button: "right",
  });
  return page.getByRole("menu", { name: `${stack} stack actions` });
}

function item(name: string) {
  return page.getByRole("menuitem", { name, exact: true });
}

// Layer 1 with a Transform on its own stack, and a selected text clip on it.
async function setUp() {
  const withTransform = withEffect(EMPTY_PROJECT, "1", "Transform").project;
  const added = withTextClip(withTransform, {
    laneId: "1",
    durationQ: TEXT_CLIP_BARS * 4,
  });
  await render(
    <FxEditor project={added.project} selection={{ clipId: added.clip.id }} />,
  );
  await expect.poll(() => count("layer", "Transform")).toBe(1);
  await expect.poll(() => count("clip", "Text")).toBe(1);
}

describe("FX chain context menus", { timeout: 60_000 }, () => {
  test("a device's menu moves it to another stack where allowed", async () => {
    await setUp();

    const menu = await openDeviceMenu("layer", "Transform");
    for (const name of ["Cut", "Copy", "Duplicate", /^Delete/, "Move"]) {
      await expect
        .element(menu.getByRole("menuitem", { name, exact: true }))
        .toBeEnabled();
    }
    await userEvent.hover(item("Move"));
    const move = page.getByRole("menu", { name: "Move" });
    // Transform places one layer, so it can't sit on the Global stack.
    await expect
      .element(move.getByRole("menuitem", { name: "to Global" }))
      .toBeDisabled();
    await expect
      .element(move.getByRole("menuitem", { name: "to Layer" }))
      .toBeDisabled();
    await userEvent.click(move.getByRole("menuitem", { name: "to Clip" }));

    await expect.poll(() => count("layer", "Transform")).toBe(0);
    expect(count("clip", "Transform")).toBe(1);
    await expect
      .poll(chainStatus)
      .toBe("Moved Transform to position 2 of 2 in Clip");

    await openDeviceMenu("clip", "Transform");
    await userEvent.hover(item("Move"));
    await userEvent.click(move.getByRole("menuitem", { name: "to Layer" }));
    await expect.poll(() => count("layer", "Transform")).toBe(1);
    expect(count("clip", "Transform")).toBe(0);

    await undo();
    await expect.poll(() => count("clip", "Transform")).toBe(1);
    await undo();
    await expect.poll(() => count("layer", "Transform")).toBe(1);
    expect(count("clip", "Transform")).toBe(0);
  });

  test("the clip's content device stays on its stack", async () => {
    await setUp();

    const menu = await openDeviceMenu("clip", "Text");
    await expect
      .element(menu.getByRole("menuitem", { name: "Cut" }))
      .toBeDisabled();
    await expect
      .element(menu.getByRole("menuitem", { name: "Copy" }))
      .toBeEnabled();
    await expect
      .element(menu.getByRole("menuitem", { name: /^Delete/ }))
      .toBeDisabled();
    await userEvent.hover(item("Move"));
    const move = page.getByRole("menu", { name: "Move" });
    for (const name of ["to Global", "to Layer", "to Clip"]) {
      await expect.element(move.getByRole("menuitem", { name })).toBeDisabled();
    }
  });

  test("copy and cut paste onto the right-clicked stack only", async () => {
    await setUp();

    await openDeviceMenu("layer", "Transform");
    await userEvent.click(item("Copy"));
    await expect.poll(chainStatus).toBe("Copied Transform");

    // Transform isn't designed for the Global stack.
    const global = await openStackMenu("Add device to Global", "Global");
    await expect
      .element(global.getByRole("menuitem", { name: "Paste" }))
      .toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => page.getByRole("menu").elements().length).toBe(0);

    await openStackMenu("Add device to this clip", "Clip");
    await userEvent.click(item("Paste"));
    await expect.poll(() => count("clip", "Transform")).toBe(1);
    expect(count("layer", "Transform")).toBe(1);

    await undo();
    await expect.poll(() => count("clip", "Transform")).toBe(0);

    await openDeviceMenu("layer", "Transform");
    await userEvent.click(item("Cut"));
    await expect.poll(() => count("layer", "Transform")).toBe(0);

    await openStackMenu("Add device to this clip", "Clip");
    await userEvent.click(item("Paste"));
    await expect.poll(() => count("clip", "Transform")).toBe(1);
    expect(count("layer", "Transform")).toBe(0);

    await undo();
    await undo();
    await expect.poll(() => count("layer", "Transform")).toBe(1);
    expect(count("clip", "Transform")).toBe(0);
  });

  test("Clear All keeps Global, Layout and the clip's content", async () => {
    await setUp();
    await openDeviceMenu("layer", "Transform");
    await userEvent.click(item("Copy"));
    await openStackMenu("Add device to this clip", "Clip");
    await userEvent.click(item("Paste"));
    await expect.poll(() => count("clip", "Transform")).toBe(1);

    await openStackMenu("Add device to this layer", "Layer");
    await userEvent.click(item("Clear All"));
    await expect.poll(() => count("layer", "Transform")).toBe(0);
    expect(count("clip", "Transform")).toBe(0);
    expect(count("layer", "Layout")).toBe(1);
    expect(count("clip", "Text")).toBe(1);
    expect(count("global", "Order")).toBe(1);
    await expect.poll(chainStatus).toBe("Cleared 2 devices");

    const menu = await openStackMenu("Add device to this clip", "Clip");
    await expect
      .element(menu.getByRole("menuitem", { name: "Clear All" }))
      .toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => page.getByRole("menu").elements().length).toBe(0);

    await undo();
    await expect.poll(() => count("layer", "Transform")).toBe(1);
    expect(count("clip", "Transform")).toBe(1);
  });
});
