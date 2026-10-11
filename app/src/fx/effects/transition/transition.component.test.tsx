import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { TEXT_CLIP_BARS } from "../../../app/constants.ts";
import type { ProjectState } from "../../../app/types.ts";
import { addFromMenu } from "../../../component-test/fx-actions.ts";
import {
  FxClipEditor,
  insertClip,
  withLayersBelow,
} from "../../../component-test/fx-clip.tsx";
import { EMPTY_PROJECT } from "../../../component-test/fx-projects.ts";
import { describeFxClip } from "../../../fx-clip.ts";
import "./transition.ts";

// Transition blends what is beneath an FX clip from its start to its end,
// so only an FX clip's add menu offers it.

// The item names of the Transform submenu of the add menu `button` opens.
async function transformMenu(button: string) {
  await userEvent.click(page.getByRole("button", { name: button }));
  page
    .getByRole("menuitem", { name: "Transform", exact: true })
    .first()
    .element()
    .focus();
  await userEvent.keyboard("{ArrowRight}");
  const items = page.getByRole("menu").last().getByRole("menuitem");
  await expect.element(items.first()).toBeVisible();
  const names = items.elements().map((item) => item.textContent ?? "");
  await userEvent.keyboard("{Escape}");
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => page.getByRole("menu").elements()).toHaveLength(0);
  return names;
}

describe("Transition", { timeout: 60_000 }, () => {
  test("only an FX clip's add menu offers Transition", async () => {
    // Layer 1 and an added Layer 2, with an FX clip on Layer 1.
    const layers = withLayersBelow(EMPTY_PROJECT, 1);
    const { project, clipId } = await insertClip(layers, "fx", "1", 1, 5);
    let current: ProjectState = project;
    const onChange = (history: { present: ProjectState }) => {
      current = history.present;
    };
    const screen = await render(
      <FxClipEditor
        key="fx"
        project={project}
        selection={{ clipId }}
        onChange={onChange}
      />,
    );

    // An FX clip offers it.
    await addFromMenu("Add device to this clip", "Transform", /^Transition/);
    const label = () =>
      document.querySelector(
        '[data-timeline-lane-id="1"] .clip-card--fx strong',
      )?.textContent;
    await expect.poll(label).toBe("FX · Transition");
    expect(describeFxClip(current.effects, clipId)).toBe("FX · Transition");

    // Its Animation section holds Timing, spanning the clip by default,
    // Motion In, Motion Out and Type.
    const animation = page.elementLocator(
      document.querySelector('section[aria-label="Transition animation"]') ??
        missing("Transition animation section"),
    );
    for (const name of ["Motion In", "Motion Out", "Type"]) {
      await expect
        .element(animation.getByRole("combobox", { name }))
        .toBeVisible();
    }
    await expect
      .element(animation.getByRole("button", { name: "Full", exact: true }))
      .toHaveAttribute("aria-pressed", "true");

    // A layer and the Global stack don't offer it.
    await screen.rerender(
      <FxClipEditor
        key="fx"
        project={project}
        selection={{ laneId: "2" }}
        onChange={onChange}
      />,
    );
    await expect
      .element(page.getByRole("button", { name: "Add device to this layer" }))
      .toBeVisible();
    for (const button of ["Add device to this layer", "Add device to Global"]) {
      const names = await transformMenu(button);
      expect(names.some((name) => name.startsWith("Zoom & Pan"))).toBe(true);
      expect(names.some((name) => name.startsWith("Transition"))).toBe(false);
    }

    // Nor does a layer clip's own stack: Layer 2's Insert text at playhead.
    const text = await insertClip(current, "text", "2", 0, TEXT_CLIP_BARS * 4);
    expect(text.selectedClipId).toBe(text.clipId);
    await screen.rerender(
      <FxClipEditor
        key="text"
        project={text.project}
        selection={{ clipId: text.clipId }}
        onChange={onChange}
      />,
    );
    expect(
      document.querySelectorAll(
        '[data-timeline-lane-id="2"] .clip-card--selected',
      ),
    ).toHaveLength(1);
    const names = await transformMenu("Add device to this clip");
    expect(names.some((name) => name.startsWith("Transform"))).toBe(true);
    expect(names.some((name) => name.startsWith("Transition"))).toBe(false);
  });
});

function missing(name: string): never {
  throw new Error(`No ${name}`);
}
