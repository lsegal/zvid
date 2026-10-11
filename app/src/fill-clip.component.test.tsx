import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { getShortcutLabels } from "./app/shortcut-labels.ts";
import { click, down, move, up } from "./component-test/cdp-mouse.ts";
import {
  type EditorState,
  renderEditor,
} from "./component-test/editor-harness.tsx";
import { isFillClip } from "./fill-clip.ts";

// The selection menu's Insert Fill Clip turns the timeline selection into a
// fill clip, painted by a Color effect that switches between a color and a
// gradient, in the editor harness that wires the timeline, menus and FX
// panel as App does.

const MOD = getShortcutLabels().mac ? "Meta" : "Control";

function lane(id: string) {
  const element = document.querySelector<HTMLElement>(
    `[data-timeline-lane-id="${id}"]`,
  );
  if (!element) {
    throw new Error(`No layer ${id}`);
  }
  return element;
}

async function dragSelection(laneId: string, fromX: number, toX: number) {
  const bounds = lane(laneId).getBoundingClientRect();
  const y = bounds.y + bounds.height / 2;
  await move(bounds.x + fromX, y);
  await down();
  await move(bounds.x + (fromX + toX) / 2, y);
  await move(bounds.x + toX, y);
  await up();
}

function fills() {
  return lane("1").querySelectorAll<HTMLElement>(".clip-card--fill");
}

function selectionCount() {
  return document.querySelectorAll(".timeline-selection").length;
}

test("Insert Fill Clip adds a fill clip with a Solid/Gradient Color effect", async () => {
  let state: EditorState | undefined;
  await renderEditor({
    onState: (next) => {
      state = next;
    },
  });
  await expect.poll(() => document.querySelector("[data-timeline-lane-id]")).toBeTruthy();

  await dragSelection("1", 40, 260);
  await expect.poll(selectionCount).toBe(1);

  // Right-clicking the selection keeps it and offers Insert Fill Clip.
  const bounds = lane("1").getBoundingClientRect();
  await click(bounds.x + 150, bounds.y + 20, { button: "right" });
  await userEvent.click(
    page
      .getByRole("menu", { name: "Selection actions" })
      .getByRole("menuitem", { name: "Insert Fill Clip" }),
  );

  await expect.poll(() => fills().length).toBe(1);
  const fill = fills()[0];
  expect(fill.textContent).toContain("Fill");
  expect(fill.className).toMatch(/clip-card--selected/);
  expect(selectionCount()).toBe(0);
  expect(state?.project.clips.filter(isFillClip)).toHaveLength(1);

  // The layer got a Color effect in Solid mode: one color swatch.
  const device = page.getByRole("region", { name: "Color", exact: true });
  await expect.element(device).toBeVisible();
  await expect
    .element(device.getByRole("button", { name: "Solid" }))
    .toHaveAttribute("aria-pressed", "true");
  await expect
    .element(device.getByRole("button", { name: "Edit Color" }))
    .toBeVisible();
  expect(
    device.getByRole("button", { name: "Edit Gradient" }).elements(),
  ).toHaveLength(0);

  // Gradient mode swaps the color swatch for a gradient swatch, and the
  // clip previews the gradient.
  await userEvent.click(device.getByRole("button", { name: "Gradient" }));
  await expect
    .element(device.getByRole("button", { name: "Edit Color" }))
    .not.toBeInTheDocument();
  const gradientSwatch = device.getByRole("button", { name: "Edit Gradient" });
  await expect.element(gradientSwatch).toBeVisible();
  await expect
    .poll(() =>
      fills()[0]?.querySelector(".clip-card__fill")?.getAttribute("style"),
    )
    .toMatch(/linear-gradient/);

  // The swatch opens the picker in a popover.
  await userEvent.click(gradientSwatch);
  await expect
    .poll(() => document.querySelector(".popover-content"))
    .toBeTruthy();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => document.querySelector(".popover-content")).toBeNull();

  // Undo removes the fill and its Color effect in one step.
  await userEvent.keyboard(`{${MOD}>}z{/${MOD}}`);
  await userEvent.keyboard(`{${MOD}>}z{/${MOD}}`);
  await expect.poll(() => fills().length).toBe(0);
});
