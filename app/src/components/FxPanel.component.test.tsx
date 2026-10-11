import { beforeEach, describe, expect, test } from "vitest";
import { type Locator, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { TEXT_CLIP_BARS } from "../app/constants.ts";
import { addFromMenu } from "../component-test/fx-actions.ts";
import { stackDevices, undo, withLayers } from "../component-test/fx-chain.ts";
import { FxEditor } from "../component-test/fx-editor.tsx";
import { EMPTY_PROJECT, withTextClip } from "../component-test/fx-projects.ts";

// The FX panel's chain: how devices lay out their knobs, the Global Order a
// new session starts with, the Global | Layer | Clip sections, and the
// Order's Layers menu. Whether a tall chain leaves the arrangement usable
// stays in e2e/fx-panel.spec.ts, as it needs App's whole layout.

const section = (name: string) => {
  const element = document.querySelector(`section[aria-label="${name}"]`);
  if (!element) {
    throw new Error(`No ${name} section`);
  }
  return element;
};
const sectionCount = (name: string) =>
  document.querySelectorAll(`section[aria-label="${name}"]`).length;

const normalized = (element: Element) =>
  (element.textContent ?? "").replace(/\s+/g, " ").trim();
// The text of each element, as Playwright's toHaveText([...]) reads it.
const texts = (locator: Locator) => locator.elements().map(normalized);

// Three layers, Layer 3 selected, with `effect` added from its add menu.
async function addToLayer3(
  category: string,
  effect: string,
  item: RegExp | string = effect,
) {
  await render(
    <FxEditor
      project={withLayers(EMPTY_PROJECT)}
      selection={{ laneId: "3" }}
    />,
  );
  await addFromMenu("Add device to this layer", category, item);
  await expect.poll(() => sectionCount(effect)).toBe(1);
  return section(effect);
}

describe("FX panel", { timeout: 60_000 }, () => {
  beforeEach(() => {
    // A fresh page, as each e2e test had: no folded devices.
    localStorage.clear();
  });

  // Knobs fill at most two rows: Transform reads X Y Width Height, then
  // Origin X Origin Y Rotation.
  test("Transform lays its knobs out in two rows", async () => {
    const transform = await addToLayer3(
      "Transform",
      "Transform",
      // The item, not its category of the same name.
      /^Transform ./,
    );

    const knobs = [...transform.querySelectorAll(".fx-device-panel__body > *")];
    expect(knobs).toHaveLength(7);
    const rows = new Map<number, string[]>();
    for (const knob of knobs) {
      const top = Math.round(knob.getBoundingClientRect().y);
      const label = knob.querySelector(".knob__label")?.textContent ?? "";
      rows.set(top, [...(rows.get(top) ?? []), label]);
    }
    expect(
      [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row),
    ).toEqual([
      ["X", "Y", "Width", "Height"],
      ["Origin X", "Origin Y", "Rotation"],
    ]);
  });

  // Move puts its Motion curve on its own row, then a Start row and an End
  // row of Transform's knobs, each led by its label.
  test("Move lays out Motion, then labeled Start and End rows", async () => {
    const move = page.elementLocator(await addToLayer3("Transform", "Move"));
    const motion = move.getByRole("group", { name: "Motion" });
    expect(texts(motion.getByRole("button"))).toEqual([
      "Linear",
      "Ease In",
      "Ease Out",
      "Ease In Out",
    ]);
    await expect
      .element(motion.getByRole("button", { name: "Ease In Out" }))
      .toHaveAttribute("aria-pressed", "true");

    // Each row's label sits left of its knobs, which share one line below
    // the previous row's.
    let previousTop = motion.element().getBoundingClientRect().y;
    for (const name of ["Start", "End"]) {
      const row = move.getByRole("group", { name }).element();
      const labels = [...row.querySelectorAll(".knob__label")];
      expect(labels.map(normalized)).toEqual([
        "X",
        "Y",
        "Width",
        "Height",
        "Origin X",
        "Origin Y",
        "Rotation",
      ]);
      const tops = new Set(
        labels.map((label) => Math.round(label.getBoundingClientRect().y)),
      );
      expect(tops.size).toBe(1);
      const [top] = tops;
      expect(top).toBeGreaterThan(previousTop);
      previousTop = top;

      const legend = row.querySelector("legend")?.getBoundingClientRect();
      const first = labels[0].getBoundingClientRect();
      expect(legend).toBeDefined();
      expect((legend?.x ?? 0) + (legend?.width ?? 0)).toBeLessThanOrEqual(
        first.x,
      );
    }
  });

  // Every new session arranges its layers with a Vertical Order on the
  // Global stack. Removing it can be undone, and leaves the Global section
  // without any note about the missing Order.
  test("a new session has a Global Order that can be removed and restored", async () => {
    await render(<FxEditor selection={{ laneId: "1" }} />);

    expect(sectionCount("Order")).toBe(1);
    expect(section("Order").textContent).toContain("Vertical");

    await userEvent.click(
      page
        .elementLocator(section("Order"))
        .getByRole("button", { name: "Remove Order" }),
    );
    await expect.poll(() => sectionCount("Order")).toBe(0);
    expect(document.querySelector(".fx-chain")?.textContent).not.toContain(
      "No Order",
    );

    await undo();
    await expect.poll(() => sectionCount("Order")).toBe(1);
  });

  // The chain reads GLOBAL | LAYER, and GLOBAL | LAYER | CLIP once a clip
  // is selected; the title names the selection.
  test("the FX panel shows Global, then the layer, then the selected clip", async () => {
    const project = withLayers(EMPTY_PROJECT, 1);
    const title = () =>
      normalized(document.querySelector(".fx-panel__toggle") as Element);
    const sections = () =>
      [...document.querySelectorAll(".fx-chain [data-fx-divider]")].map(
        normalized,
      );

    const screen = await render(
      <FxEditor project={project} selection={{ laneId: "2" }} />,
    );
    await expect.poll(title).toBe("Layer 2 Effects");
    expect(sections()).toEqual(["Global", "Layer"]);
    await expect
      .element(page.getByRole("button", { name: "Add device to Global" }))
      .toBeVisible();
    expect(
      page.getByRole("button", { name: "Add device to this clip" }).elements(),
    ).toHaveLength(0);

    // Insert text at playhead on Layer 2 selects the new clip.
    const added = withTextClip(project, {
      laneId: "2",
      durationQ: TEXT_CLIP_BARS * 4,
    });
    await screen.rerender(
      <FxEditor
        key="text-clip"
        project={added.project}
        selection={{ clipId: added.clip.id }}
      />,
    );
    await expect.poll(title).toBe("Clip Text Effects (Layer 2)");
    expect(sections()).toEqual(["Global", "Layer", "Clip"]);

    // Global's Order sits left of the layer's devices, which sit left of
    // the clip's add slot.
    const order = section("Order").getBoundingClientRect();
    const layout = section("Layout").getBoundingClientRect();
    const addToClip = page
      .getByRole("button", { name: "Add device to this clip" })
      .element()
      .getBoundingClientRect();
    expect(order.x).toBeLessThan(layout.x);
    expect(layout.x).toBeLessThan(addToClip.x);

    // Adding from the clip slot puts the device on the clip's stack.
    await addFromMenu("Add device to this clip", "Transform", /^Transform ./);
    await expect.poll(() => stackDevices("clip", "Transform").length).toBe(1);
  });

  // The Order's Layers button opens a checkmark menu of every layer.
  // Toggling a row leaves the menu open and updates the button, and each
  // toggle is one undo step.
  test("the Order's Layers menu toggles layers in place", async () => {
    await render(
      <FxEditor
        project={withLayers(EMPTY_PROJECT)}
        selection={{ laneId: "1" }}
      />,
    );

    // Located afresh each time: its accessible name changes.
    const button = () =>
      section("Order").querySelector(".fx-layers__trigger") as Element;
    const label = () => normalized(button());
    expect(label()).toBe("Layers: All");

    await userEvent.click(page.elementLocator(button()));
    const menu = page.getByRole("menu", { name: /^Layers: / });
    await expect.element(menu).toBeVisible();
    const rows = menu.getByRole("menuitemcheckbox");
    const count = rows.elements().length;
    expect(count).toBeGreaterThan(1);
    for (let index = 0; index < count; index++) {
      await expect
        .element(rows.nth(index))
        .toHaveAttribute("aria-checked", "true");
    }

    await userEvent.click(rows.first());
    await expect.element(menu).toBeVisible();
    await expect.element(rows.first()).toHaveAttribute("aria-checked", "false");
    await expect.poll(label).toBe(`Layers: ${count - 1} of ${count}`);

    // Enter toggles the highlighted row from the keyboard.
    (rows.nth(1).element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(menu).toBeVisible();
    await expect.poll(label).toBe(`Layers: ${count - 2} of ${count}`);

    await userEvent.click(menu.getByRole("menuitem", { name: "Exclude all" }));
    await expect.element(menu).toBeVisible();
    await expect.poll(label).toBe("Layers: None");

    await userEvent.click(menu.getByRole("menuitem", { name: "Include all" }));
    await expect.poll(label).toBe("Layers: All");

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => menu.elements().length).toBe(0);

    await undo();
    await expect.poll(label).toBe("Layers: None");
    await undo();
    await expect.poll(label).toBe(`Layers: ${count - 2} of ${count}`);
  });
});
