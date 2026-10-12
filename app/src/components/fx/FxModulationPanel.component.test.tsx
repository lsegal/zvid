import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { selectSourceSpan } from "../../app/source-selection.ts";
import { FxEditor } from "../../component-test/fx-editor.tsx";
import { LFO_SYNC_RATES } from "../../fx-animation-defaults.ts";
import {
  EMPTY_PROJECT,
  mediaItem,
  withDroppedMedia,
} from "../../component-test/fx-projects.ts";
import { setViewport } from "../../component-test/viewport.ts";
import { FxModulationPanel } from "./FxModulationPanel.tsx";

// The Modulation modifier: the audio side's Animation. Audio devices get a
// motion-icon toggle beside their power button that attaches a collapsible
// Modulation section to the device's right edge, with Transient and LFO
// modes.

describe(FxModulationPanel.name, { timeout: 60_000 }, () => {
  test("an audio device's Modulation section attaches, switches modes and folds", async () => {
    await setViewport({ width: 1600, height: 1200 });
    const dropped = withDroppedMedia(
      EMPTY_PROJECT,
      mediaItem({ kind: "audio" }),
    );
    await render(
      <FxEditor
        project={dropped.project}
        selection={{ source: selectSourceSpan(dropped.span) }}
      />,
    );

    const gainPanels = () =>
      document.querySelectorAll<HTMLElement>(
        '.fx-chain section[aria-label="Gain"]',
      );
    expect(gainPanels()).toHaveLength(1);
    const gain = page.elementLocator(gainPanels()[0]);
    const sections = () =>
      document.querySelectorAll<HTMLElement>(
        'section[aria-label="Gain modulation"]',
      );
    const section = () => page.elementLocator(sections()[0]);
    // A select's shown value, as Playwright's toHaveText reads it.
    const comboText = (name: string) =>
      section().getByRole("combobox", { name }).element().textContent?.trim();
    // Off until turned on, so a new audio effect sounds as it always has.
    const turnOn = gain.getByRole("button", {
      name: "Turn Modulation On for Gain",
    });
    await expect.element(turnOn).toHaveAttribute("aria-pressed", "false");
    expect(sections()).toHaveLength(0);

    await userEvent.click(turnOn);
    await expect
      .element(
        gain.getByRole("button", { name: "Turn Modulation Off for Gain" }),
      )
      .toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => sections().length).toBe(1);
    await expect.element(section()).toBeVisible();

    // It's attached to the device's right edge.
    const device = gainPanels()[0].getBoundingClientRect();
    const attached = sections()[0].getBoundingClientRect();
    expect(
      Math.abs(attached.x - (device.x + device.width)),
    ).toBeLessThanOrEqual(2);

    // A decorative trace of the modulation sits in the title row.
    const graphs = () =>
      sections()[0].querySelectorAll<HTMLElement>(
        "header .fx-modulation-graph",
      );
    expect(graphs()).toHaveLength(1);
    const graph = page.elementLocator(graphs()[0]);
    await expect.element(graph).toBeVisible();
    await expect.element(graph).toHaveAttribute("aria-hidden", "true");
    const graphBox = graphs()[0].getBoundingClientRect();
    expect([graphBox.width, graphBox.height]).toEqual([56, 16]);

    // Transient, with Reactive's controls and Gain's defaults.
    const mode = section().getByRole("group", { name: "Mode" });
    expect(
      mode
        .getByRole("button")
        .elements()
        .map((button) => button.textContent?.trim()),
    ).toEqual(["Transient", "LFO"]);
    await expect
      .element(mode.getByRole("button", { name: "Transient" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(section().getByRole("group", { name: "Timing" }))
      .toBeVisible();
    await expect
      .element(section().getByRole("slider", { name: "Reactivity" }))
      .toHaveAttribute("aria-valuetext", "0.3");
    await expect.poll(() => comboText("Motion")).toBe("Bounce");
    // Mute is a toggle, so only the level can be modulated.
    await expect
      .element(section().getByRole("button", { name: "Parameters: 1 of 1" }))
      .toBeVisible();

    // LFO: Shape, a synced Rate, Depth, Phase and Parameters.
    await userEvent.click(mode.getByRole("button", { name: "LFO" }));
    await expect.poll(() => comboText("Shape")).toBe("Sine");
    const sync = section().getByRole("group", { name: "Sync" });
    await expect
      .element(sync.getByRole("button", { name: "On" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => comboText("Rate")).toBe("1/8");
    // The synced Rate offers every note value from 4 Bars down to 1/32.
    await userEvent.click(section().getByRole("combobox", { name: "Rate" }));
    const rates = page.getByRole("listbox").getByRole("option");
    await expect.element(rates.first()).toBeVisible();
    expect(rates.elements().map((option) => option.textContent?.trim())).toEqual(
      [...LFO_SYNC_RATES],
    );
    await userEvent.click(page.getByRole("option", { name: "1/32", exact: true }));
    await expect.poll(() => comboText("Rate")).toBe("1/32");
    await expect
      .element(section().getByRole("slider", { name: "Depth" }))
      .toHaveAttribute("aria-valuetext", "0.3");
    await expect
      .element(section().getByRole("slider", { name: "Phase" }))
      .toHaveAttribute("aria-valuetext", "0°");
    // Free-running, Rate is a knob in Hz.
    await userEvent.click(sync.getByRole("button", { name: "Off" }));
    await expect
      .element(section().getByRole("slider", { name: "Rate" }))
      .toHaveAttribute("aria-valuetext", "1.00 Hz");

    // It folds into a strip of its own.
    await userEvent.click(
      section().getByRole("button", { name: "Collapse Gain modulation" }),
    );
    await expect
      .element(
        section().getByRole("button", { name: "Expand Gain modulation" }),
      )
      .toBeVisible();
    // The strip has no trace.
    expect(sections()[0].querySelectorAll(".fx-modulation-graph")).toHaveLength(
      0,
    );
    await userEvent.click(
      section().getByRole("button", { name: "Expand Gain modulation" }),
    );

    // Turned off, the section goes and the settings stay for next time.
    await userEvent.click(
      gain.getByRole("button", { name: "Turn Modulation Off for Gain" }),
    );
    await expect.poll(() => sections().length).toBe(0);
    await userEvent.click(
      gain.getByRole("button", { name: "Turn Modulation On for Gain" }),
    );
    await expect.poll(() => sections().length).toBe(1);
    await expect
      .element(
        section()
          .getByRole("group", { name: "Mode" })
          .getByRole("button", { name: "LFO" }),
      )
      .toHaveAttribute("aria-pressed", "true");
  });
});
