import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { FxClipEditor, insertClip } from "./component-test/fx-clip.tsx";
import { EMPTY_PROJECT } from "./component-test/fx-projects.ts";
import { describeFxClip, isFxClip } from "./fx-clip.ts";

// Insert FX Clip adds an empty FX clip over the timeline selection and
// selects it, so the FX panel's Clip section opens on its stack.

describe("FX clip", { timeout: 60_000 }, () => {
  test("Insert FX Clip adds an empty FX clip that lists its effects", async () => {
    // The selection menu's Insert FX Clip over quarters 1-6 of Layer 1.
    const inserted = await insertClip(EMPTY_PROJECT, "fx", "1", 1, 5);
    const added = inserted.project.clips.find(
      (clip) => clip.id === inserted.clipId,
    );
    expect(isFxClip(added)).toBe(true);
    expect(added?.laneId).toBe("1");
    expect(inserted.project.clips.filter(isFxClip)).toHaveLength(1);
    // The new clip is selected and the timeline selection is gone.
    expect(inserted.selectedClipId).toBe(inserted.clipId);
    expect(inserted.pendingSelection).toBeNull();

    let project = inserted.project;
    await render(
      <FxClipEditor
        project={project}
        selection={{ clipId: inserted.clipId }}
        onChange={(history) => {
          project = history.present;
        }}
      />,
    );

    const cards = () =>
      document.querySelectorAll<HTMLElement>(
        '[data-timeline-lane-id="1"] .clip-card--fx',
      );
    expect(cards()).toHaveLength(1);
    const clip = cards()[0];
    expect(clip.classList.contains("clip-card--selected")).toBe(true);
    expect(clip.querySelector(".clip-card__glyph")?.textContent).toBe("FX");
    const label = () => clip.querySelector("strong")?.textContent;
    expect(label()).toBe("FX (empty)");

    // The Clip section's add menu offers only effects that work on what is
    // beneath the clip.
    await userEvent.click(
      page.getByRole("button", { name: "Add device to this clip" }),
    );
    const menu = page.getByRole("menu").first();
    await expect.element(menu).toBeVisible();
    expect(
      menu.getByRole("menuitem", { name: "Text", exact: true }).elements(),
    ).toHaveLength(0);
    menu
      .getByRole("menuitem", { name: "Transform", exact: true })
      .element()
      .focus();
    await userEvent.keyboard("{ArrowRight}");
    const submenu = () => page.getByRole("menu").last();
    await expect
      .element(submenu().getByRole("menuitem", { name: /^Transform/ }))
      .toBeVisible();
    await expect
      .element(submenu().getByRole("menuitem", { name: /^Order / }))
      .toBeVisible();
    expect(
      submenu()
        .getByRole("menuitem", { name: /^Layout/ })
        .elements(),
    ).toHaveLength(0);

    menu
      .getByRole("menuitem", { name: "Color", exact: true })
      .element()
      .focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect
      .element(submenu().getByRole("menuitem", { name: /^Colorize/ }))
      .toBeVisible();
    expect(
      submenu()
        .getByRole("menuitem", { name: /^Color(?!ize)/ })
        .elements(),
    ).toHaveLength(0);
    await userEvent.click(
      submenu().getByRole("menuitem", { name: /^Colorize/ }),
    );

    await expect.poll(label).toBe("FX · Colorize");
    expect([...cards()]).toEqual([clip]);
    expect(describeFxClip(project.effects, inserted.clipId)).toBe(
      "FX · Colorize",
    );
  });
});
