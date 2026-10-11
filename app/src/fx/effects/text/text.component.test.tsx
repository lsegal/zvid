import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ProjectState } from "../../../app/types.ts";
import { EMPTY_PROJECT } from "../../../component-test/fx-projects.ts";
import { TextWorkspace } from "../../../component-test/text-workspace.tsx";
import { TEXT_EFFECT_NAME } from "./text-style.ts";

// The selection menu's Insert Text Clip turns the timeline selection into a
// text clip, styled from the FX panel by its own Text effect.

const MOD = /Mac/.test(navigator.platform) ? "Meta" : "Control";
const clips = () => document.querySelectorAll(".clip-card--text");

describe("Text", { timeout: 60_000 }, () => {
  test("Insert Text Clip adds a text clip edited from its Text effect", async () => {
    let project: ProjectState = EMPTY_PROJECT;
    await render(
      <TextWorkspace
        project={EMPTY_PROJECT}
        onChange={(history) => {
          project = history.present;
        }}
        selection={{
          id: "selection-1",
          laneId: EMPTY_PROJECT.lanes[0].id,
          startQ: 1,
          durationQ: 6,
        }}
      />,
    );

    expect(document.querySelectorAll(".timeline-selection")).toHaveLength(1);
    await userEvent.click(
      page.getByRole("button", { name: "Insert Text Clip" }),
    );
    await expect.poll(() => clips().length).toBe(1);
    const clip = page.elementLocator(clips()[0]);
    await expect.element(clip).toHaveClass(/clip-card--selected/);
    await expect
      .element(clip.getByText("T", { exact: true }))
      .toHaveClass("clip-card__glyph");
    // The clip card's first line, as the timeline shows it.
    const label = () => clips()[0]?.querySelector("strong")?.textContent;
    await expect.poll(label).toBe("Text");
    expect(document.querySelectorAll(".timeline-selection")).toHaveLength(0);

    await expect
      .poll(() => document.querySelector('section[aria-label="Text"]'))
      .not.toBeNull();
    const device = page.elementLocator(
      document.querySelector('section[aria-label="Text"]') as Element,
    );
    await expect.element(device).toBeVisible();

    // Typing updates the clip's first line as it goes, and leaving the field
    // commits the edit as one undo step.
    const text = device.getByRole("textbox", { name: "Text" });
    await userEvent.fill(text, "Hello there\nSecond line");
    await expect.poll(label).toBe("Hello there");
    (text.element() as HTMLElement).blur();

    // Style toggles and a segmented alignment.
    const italic = device.getByRole("button", { name: "Italic" });
    await userEvent.click(italic);
    await expect.element(italic).toHaveAttribute("aria-pressed", "true");
    const right = device
      .getByRole("group", { name: "Align" })
      .getByRole("button", { name: "Right" });
    await userEvent.click(right);
    await expect.element(right).toHaveAttribute("aria-pressed", "true");

    // Every weight for Inter.
    const weight = device.getByRole("combobox", { name: "Weight" });
    await userEvent.click(weight);
    await expect
      .poll(() => page.getByRole("option").elements())
      .toHaveLength(9);
    await userEvent.keyboard("{Escape}");

    // The font list is searchable; each row previews its font.
    await userEvent.click(device.getByRole("button", { name: "Font: Inter" }));
    await expect
      .poll(() => document.querySelector(".font-picker"))
      .not.toBeNull();
    const picker = page.elementLocator(
      document.querySelector(".font-picker") as Element,
    );
    await expect.element(picker).toBeVisible();
    await expect.element(picker.getByText("Bundled")).toBeVisible();
    await expect.element(picker.getByText("Google Fonts")).toBeVisible();
    await userEvent.fill(picker.getByPlaceholder("Search fonts"), "anto");
    const anton = picker.getByRole("option", { name: "Anton" });
    await expect
      .poll(
        () =>
          getComputedStyle(
            anton.element().querySelector(".font-picker__preview") as Element,
          ).fontFamily,
      )
      .toMatch(/Anton/);
    await userEvent.click(anton);
    await expect.poll(() => document.querySelector(".font-picker")).toBeNull();
    await expect
      .element(device.getByRole("button", { name: "Font: Anton" }))
      .toBeVisible();
    // Anton only has a regular weight.
    await userEvent.click(weight);
    await expect
      .poll(() =>
        page
          .getByRole("option")
          .elements()
          .map((option) => option.textContent),
      )
      .toEqual(["Regular"]);
    await userEvent.keyboard("{Escape}");

    // Gradient fill swaps the color swatch for a gradient one; the shadow
    // controls show once it is on.
    await userEvent.click(
      device
        .getByRole("group", { name: "Fill" })
        .getByRole("button", { name: "Gradient" }),
    );
    await expect
      .element(device.getByRole("button", { name: "Edit Gradient" }))
      .toBeVisible();
    expect(
      device.getByRole("button", { name: "Edit Color" }).elements(),
    ).toHaveLength(0);
    expect(device.getByText("Blur").elements()).toHaveLength(0);
    await userEvent.click(
      device
        .getByRole("group", { name: "Shadow" })
        .getByRole("button", { name: "On" }),
    );
    await expect
      .element(device.getByText("Blur", { exact: true }))
      .toBeVisible();

    // Resize to fit is a toggle.
    const fit = device.getByRole("group", { name: "Resize to fit" });
    await userEvent.click(fit.getByRole("button", { name: "On" }));
    await expect
      .element(fit.getByRole("button", { name: "On" }))
      .toHaveAttribute("aria-pressed", "true");

    // Undo steps back through the seven edits, text last, then removes the
    // clip and its Text effect.
    for (let step = 0; step < 7; step += 1) {
      await userEvent.keyboard(`{${MOD}>}z{/${MOD}}`);
    }
    await expect.poll(label).toBe("Text");
    await userEvent.keyboard(`{${MOD}>}z{/${MOD}}`);
    await expect.poll(() => clips().length).toBe(0);
    expect(project.clips).toHaveLength(0);
    expect(
      project.effects.filter(
        (effect) => effect.effectName === TEXT_EFFECT_NAME,
      ),
    ).toHaveLength(0);
  });
});
