import { beforeEach, describe, expect, test } from "vitest";
import { type Locator, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { addFromMenu } from "../../component-test/fx-actions.ts";
import { FxEditor } from "../../component-test/fx-editor.tsx";
import { CLIP_MOTIONS, LFO_SYNC_RATES } from "../../fx-animation-defaults.ts";
import { FX_COLLAPSED_STORAGE_KEY } from "../../fx-chain.ts";

// The Animation modifier: a motion-icon toggle beside each device's power
// button that attaches a collapsible Animation section to the device's right
// edge. A newly added device has it on.

const section = (name: string) =>
  page.elementLocator(
    document.querySelector(`section[aria-label="${name}"]`) ??
      (() => {
        throw new Error(`No ${name} section`);
      })(),
  );
const sectionCount = (name: string) =>
  document.querySelectorAll(`section[aria-label="${name}"]`).length;

// The text of each element, as Playwright's toHaveText([...]) reads it.
const normalized = (element: Element) =>
  (element.textContent ?? "").replace(/\s+/g, " ").trim();
const texts = (locator: Locator) => locator.elements().map(normalized);

// The knob labels in `locator`, in order.
const knobLabels = (locator: Locator) =>
  [...locator.element().querySelectorAll(".knob__label")].map(normalized);

// An element's text, as Playwright's toHaveText reads it.
const textOf = (locator: Locator) => texts(locator)[0];

const box = (locator: Locator) => locator.element().getBoundingClientRect();

// Layer 1 selected, as a click on its header selects it.
async function openLayer() {
  await render(<FxEditor selection={{ laneId: "1" }} />);
}

// Adds Pixelate to Layer 1 from the add menu.
async function addPixelate() {
  await addFromMenu("Add device to this layer", "Stylize", "Pixelate");
  await expect.poll(() => sectionCount("Pixelate")).toBe(1);
}

describe("FX Animation", { timeout: 60_000 }, () => {
  beforeEach(() => {
    // A fresh page, as each e2e test had: no folded devices.
    localStorage.clear();
  });

  test("every device but Layout has an Animation toggle beside its power button", async () => {
    await openLayer();
    await addPixelate();

    expect(sectionCount("Layout")).toBe(1);
    expect(
      section("Layout").element().querySelectorAll(".fx-device-panel__animate"),
    ).toHaveLength(0);

    const pixelate = section("Pixelate");
    const toggle = pixelate.getByRole("button", {
      name: "Turn Animation Off for Pixelate",
    });
    await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
    // A decorative motion icon, like the power button's, rather than text.
    expect(
      toggle.element().querySelectorAll('svg[aria-hidden="true"]'),
    ).toHaveLength(1);
    expect(toggle.element().textContent).toBe("");
    const power = box(
      pixelate.getByRole("button", { name: "Bypass Pixelate" }),
    );
    const toggleBox = box(toggle);
    expect(toggleBox.x).toBeGreaterThan(power.x);
    expect(Math.round(toggleBox.width)).toBe(Math.round(power.width));
  });

  test("the Animation section attaches, switches modes and folds", async () => {
    await openLayer();
    await addPixelate();

    const pixelate = section("Pixelate");
    const animation = () => section("Pixelate animation");

    // A newly added device has it on already.
    await expect
      .element(
        pixelate.getByRole("button", {
          name: "Turn Animation Off for Pixelate",
        }),
      )
      .toHaveAttribute("aria-pressed", "true");
    await expect.element(animation()).toBeVisible();

    // It's attached to the device's right edge.
    const device = box(pixelate);
    const attached = box(animation());
    expect(
      Math.abs(attached.x - (device.x + device.width)),
    ).toBeLessThanOrEqual(2);

    // Clip mode, pre-filled with Pixelate's defaults.
    const mode = animation().getByRole("group", { name: "Mode" });
    expect(texts(mode.getByRole("button"))).toEqual([
      "Clip",
      "Reactive",
      "LFO",
    ]);
    await expect
      .element(mode.getByRole("button", { name: "Clip" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() =>
        textOf(animation().getByRole("combobox", { name: "Motion In" })),
      )
      .toBe("Ease Out");
    await expect
      .poll(() =>
        textOf(animation().getByRole("combobox", { name: "Motion Out" })),
      )
      .toBe("Ease In");
    const timing = animation().getByRole("group", { name: "Timing" });
    // Full stretches the animation over the whole clip.
    expect(texts(timing.getByRole("button"))).toEqual([
      "Slow",
      "Normal",
      "Fast",
      "Full",
    ]);
    await expect
      .element(timing.getByRole("button", { name: "Normal" }))
      .toHaveAttribute("aria-pressed", "true");

    // Reactive mode swaps in its own fields.
    await userEvent.click(mode.getByRole("button", { name: "Reactive" }));
    await expect
      .poll(
        () =>
          animation().getByRole("combobox", { name: "Motion In" }).elements()
            .length,
      )
      .toBe(0);
    await expect
      .poll(() =>
        textOf(
          animation().getByRole("combobox", { name: "Motion", exact: true }),
        ),
      )
      .toBe("Bounce");
    expect(knobLabels(animation())).toEqual(["Reactivity"]);
    await userEvent.click(
      animation().getByRole("button", { name: "Parameters: 1 of 1" }),
    );
    const items = page.getByRole("menuitemcheckbox");
    await expect.element(items.first()).toBeVisible();
    expect(texts(items)).toEqual(["Pixel Size"]);
    await expect.element(items.first()).toHaveAttribute("aria-checked", "true");
    await userEvent.click(items.first());
    await expect
      .element(items.first())
      .toHaveAttribute("aria-checked", "false");
    await userEvent.keyboard("{Escape}");
    await expect
      .element(animation().getByRole("button", { name: "Parameters: 0 of 1" }))
      .toBeVisible();

    // It folds into a strip of its own, and stays folded.
    await userEvent.click(
      animation().getByRole("button", { name: "Collapse Pixelate animation" }),
    );
    const expand = animation().getByRole("button", {
      name: "Expand Pixelate animation",
    });
    await expect.poll(() => textOf(expand)).toBe("Animation");
    expect(box(animation()).width).toBeLessThan(40);
    expect(localStorage.getItem(FX_COLLAPSED_STORAGE_KEY)).toMatch(
      /#animation/,
    );
    await userEvent.click(expand);
    await expect
      .element(animation().getByRole("group", { name: "Mode" }))
      .toBeVisible();

    // Turning it off detaches the section; turning it back on keeps the
    // settings.
    await userEvent.click(
      pixelate.getByRole("button", { name: "Turn Animation Off for Pixelate" }),
    );
    await expect.poll(() => sectionCount("Pixelate animation")).toBe(0);
    await userEvent.click(
      pixelate.getByRole("button", { name: "Turn Animation On for Pixelate" }),
    );
    await expect
      .element(
        animation()
          .getByRole("group", { name: "Mode" })
          .getByRole("button", { name: "Reactive" }),
      )
      .toHaveAttribute("aria-pressed", "true");
  });

  // LFO mode moves the selected knobs on its own, at a Rate that follows
  // the session tempo while Sync is on, or runs free in Hz.
  test("the Animation title shows a live trace in every mode", async () => {
    await openLayer();
    await addPixelate();

    const animation = () => section("Pixelate animation");
    const title = () =>
      animation().element().querySelector("header.fx-animation-panel__title");
    const graph = () => title()?.querySelector(".fx-animation-graph");
    const mode = animation().getByRole("group", { name: "Mode" });

    for (const name of ["Clip", "Reactive", "LFO"]) {
      await userEvent.click(mode.getByRole("button", { name }));
      // A decorative trace the size of Modulation's, between the title and
      // the collapse button.
      await expect.poll(() => graph()).toBeTruthy();
      const trace = page.elementLocator(graph() as Element);
      await expect.element(trace).toBeVisible();
      await expect.element(trace).toHaveAttribute("aria-hidden", "true");
      const graphBox = box(trace);
      expect([graphBox.width, graphBox.height]).toEqual([56, 16]);
      const titleName = title()
        ?.querySelector(".fx-animation-panel__name")
        ?.getBoundingClientRect();
      const collapse = box(
        animation().getByRole("button", {
          name: "Collapse Pixelate animation",
        }),
      );
      expect(titleName).toBeDefined();
      expect(graphBox.x).toBeGreaterThanOrEqual(
        (titleName?.x ?? 0) + (titleName?.width ?? 0),
      );
      expect(graphBox.x + graphBox.width).toBeLessThanOrEqual(collapse.x);
    }

    // LFO draws its waveform: the trace leaves the midline.
    await expect
      .poll(() => {
        const canvas = graph()?.querySelector("canvas");
        const context = canvas?.getContext("2d");
        if (!canvas || !context) {
          return 0;
        }
        const { data } = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        );
        const rows = new Set<number>();
        for (let index = 3; index < data.length; index += 4) {
          if (data[index] > 128) {
            rows.add(Math.floor((index - 3) / 4 / canvas.width));
          }
        }
        return rows.size;
      })
      .toBeGreaterThan(4);

    // The strip has no trace.
    await userEvent.click(
      animation().getByRole("button", { name: "Collapse Pixelate animation" }),
    );
    await expect
      .element(
        animation().getByRole("button", { name: "Expand Pixelate animation" }),
      )
      .toBeVisible();
    expect(
      animation().element().querySelectorAll(".fx-animation-graph"),
    ).toHaveLength(0);
  });

  test("LFO mode shows its Shape, Rate, Sync, Depth, Phase and Parameters", async () => {
    await openLayer();
    await addPixelate();

    const animation = () => section("Pixelate animation");
    const labels = () => knobLabels(animation());
    const mode = animation().getByRole("group", { name: "Mode" });
    await userEvent.click(mode.getByRole("button", { name: "LFO" }));
    await expect
      .element(mode.getByRole("button", { name: "LFO" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(
      animation().getByRole("combobox", { name: "Motion In" }).elements(),
    ).toHaveLength(0);

    await expect
      .poll(() => textOf(animation().getByRole("combobox", { name: "Shape" })))
      .toBe("Sine");
    const sync = animation().getByRole("group", { name: "Sync" });
    await expect
      .element(sync.getByRole("button", { name: "On" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => textOf(animation().getByRole("combobox", { name: "Rate" })))
      .toBe("1/8");
    // The synced Rate offers every note value from 4 Bars down to 1/32.
    await userEvent.click(animation().getByRole("combobox", { name: "Rate" }));
    const rates = page.getByRole("listbox").getByRole("option");
    await expect.element(rates.first()).toBeVisible();
    expect(
      rates.elements().map((option) => option.textContent?.trim()),
    ).toEqual([...LFO_SYNC_RATES]);
    await userEvent.click(
      page.getByRole("option", { name: "1/32", exact: true }),
    );
    await expect
      .poll(() => textOf(animation().getByRole("combobox", { name: "Rate" })))
      .toBe("1/32");
    expect(labels()).toEqual(["Depth", "Phase"]);
    await expect
      .element(animation().getByRole("button", { name: "Parameters: 1 of 1" }))
      .toBeVisible();

    // Free-running, the Rate is a knob in Hz.
    await userEvent.click(sync.getByRole("button", { name: "Off" }));
    await expect
      .poll(
        () =>
          animation().getByRole("combobox", { name: "Rate" }).elements().length,
      )
      .toBe(0);
    expect(labels()).toEqual(["Rate", "Depth", "Phase"]);

    // The settings stay put when switching away and back.
    await userEvent.click(mode.getByRole("button", { name: "Clip" }));
    await userEvent.click(mode.getByRole("button", { name: "LFO" }));
    await expect
      .element(sync.getByRole("button", { name: "Off" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  test("Order's Animation offers only Clip mode", async () => {
    await openLayer();

    // A new session has a Global Order, animated.
    const animation = section("Order animation");
    await expect.element(animation).toBeVisible();
    expect(
      animation.getByRole("group", { name: "Mode" }).elements(),
    ).toHaveLength(0);
    expect(
      animation.getByRole("button", { name: "Reactive" }).elements(),
    ).toHaveLength(0);
    // It only moves the clips entering and leaving beneath it, so it has no
    // Full timing.
    expect(
      texts(
        animation.getByRole("group", { name: "Timing" }).getByRole("button"),
      ),
    ).toEqual(["Slow", "Normal", "Fast"]);
    expect(animation.element().querySelectorAll(".knob__label")).toHaveLength(
      0,
    );
  });

  // Motion In and Out ease the clips sliding into and out of an Order's
  // arrangement, with the same choices as every other effect's.
  test("Order's Animation section picks Motion In and Out", async () => {
    await openLayer();
    const animation = () => section("Order animation");
    await expect.element(animation()).toBeVisible();
    await expect
      .poll(() =>
        textOf(animation().getByRole("combobox", { name: "Motion In" })),
      )
      .toBe("Ease Out");
    await expect
      .poll(() =>
        textOf(animation().getByRole("combobox", { name: "Motion Out" })),
      )
      .toBe("Ease In");

    await userEvent.click(
      animation().getByRole("combobox", { name: "Motion In" }),
    );
    const motions = page.getByRole("listbox").getByRole("option");
    await expect.element(motions.first()).toBeVisible();
    expect(
      motions.elements().map((option) => option.textContent?.trim()),
    ).toEqual([...CLIP_MOTIONS]);
    await userEvent.click(
      page.getByRole("option", { name: "None", exact: true }),
    );
    await expect
      .poll(() =>
        textOf(animation().getByRole("combobox", { name: "Motion In" })),
      )
      .toBe("None");
    // The Transition stays alongside them.
    await expect
      .element(animation().getByRole("group", { name: "Transition" }))
      .toBeVisible();
  });

  // Order's Clip mode also picks how clips enter and exit its arrangement:
  // Squish, for a new Order, or Push. No other device offers it.
  test("Order's Animation section picks a Transition", async () => {
    await openLayer();
    // A new session's Global Order is animated, at Order's defaults.
    await expect
      .element(
        section("Order").getByRole("button", {
          name: "Turn Animation Off for Order",
        }),
      )
      .toHaveAttribute("aria-pressed", "true");

    const transition = section("Order animation").getByRole("group", {
      name: "Transition",
    });
    expect(texts(transition.getByRole("button"))).toEqual(["Push", "Squish"]);
    await expect
      .element(transition.getByRole("button", { name: "Squish" }))
      .toHaveAttribute("aria-pressed", "true");

    await userEvent.click(transition.getByRole("button", { name: "Push" }));
    await expect
      .element(transition.getByRole("button", { name: "Push" }))
      .toHaveAttribute("aria-pressed", "true");

    await addPixelate();
    expect(
      section("Pixelate animation")
        .getByRole("group", { name: "Transition" })
        .elements(),
    ).toHaveLength(0);
  });
});
