import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { selectSourceSpan } from "../../../app/source-selection.ts";
import type { ProjectState } from "../../../app/types.ts";
import {
  addFromMenu,
  CLIP_DEVICES,
  devicesIn,
  typeValue,
} from "../../../component-test/fx-actions.ts";
import {
  compareHosts,
  effectChain,
  renderProjectMix,
  tone,
} from "../../../component-test/fx-audio.ts";
import {
  monoLevel,
  SPEC_PEAK,
} from "../../../component-test/fx-audio-levels.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  mediaItem,
  withDroppedMedia,
} from "../../../component-test/fx-projects.ts";
import { AUTO_PAN_EFFECT_NAME } from "./auto-pan.ts";

// Auto Pan is added from an audio clip's add menu, shows its defaults, and
// pans what the clip sounds like; the preview's worklet and the export's
// main-thread chain run it identically.

describe("Auto Pan", { timeout: 90_000 }, () => {
  test("is added to an audio clip with its defaults and pans the mix", async () => {
    const item = mediaItem({ kind: "audio", durationSeconds: 8 });
    const audio = new Map([[item.id, tone(8, 440, SPEC_PEAK)]]);
    const dropped = withDroppedMedia(EMPTY_PROJECT, item);
    let project: ProjectState = dropped.project;
    await render(
      <FxEditor
        project={project}
        selection={{ source: selectSourceSpan(dropped.span) }}
        onChange={(history) => {
          project = history.present;
        }}
      />,
    );
    // The preview's analyser hears left and right averaged.
    const level = () =>
      monoLevel(
        renderProjectMix(project, audio, { startSeconds: 2, seconds: 0.5 }),
      );
    expect(devicesIn("clip")).toHaveLength(1);

    // An audio clip's menu offers only audio effects, without headings.
    await userEvent.click(
      page.getByRole("button", { name: "Add device to this clip" }).first(),
    );
    expect(
      page
        .getByRole("menu")
        .getByRole("menuitem", { name: "Stylize" })
        .elements(),
    ).toHaveLength(0);
    await userEvent.keyboard("{Escape}");
    await addFromMenu(
      "Add device to this clip",
      "Volume & Stereo",
      AUTO_PAN_EFFECT_NAME,
    );
    await expect.poll(() => devicesIn("clip").length).toBe(2);

    const autoPan = page.elementLocator(devicesIn("clip")[1]);
    await expect.element(autoPan).toHaveAttribute("aria-label", "Auto Pan");
    await expect
      .element(autoPan.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    expect(
      autoPan.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(0);

    // Synced by default: Note shows and Rate hides.
    const sync = autoPan.getByRole("group", { name: "Sync" });
    await expect
      .element(sync.getByRole("button", { name: "On" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(autoPan.getByRole("combobox", { name: "Note" }))
      .toHaveTextContent("1 bar");
    expect(
      autoPan.getByRole("slider", { name: "Rate" }).elements(),
    ).toHaveLength(0);
    await expect
      .element(autoPan.getByRole("slider", { name: "Depth" }))
      .toHaveAttribute("aria-valuetext", "100%");
    const shape = autoPan.getByRole("group", { name: "Shape" });
    await expect
      .element(shape.getByRole("button", { name: "Sine" }))
      .toHaveAttribute("aria-pressed", "true");

    // Free-running, Rate shows at 1 Hz and Note hides.
    await userEvent.click(sync.getByRole("button", { name: "Off" }));
    await expect
      .element(autoPan.getByRole("slider", { name: "Rate" }))
      .toHaveAttribute("aria-valuetext", "1.0 Hz");
    expect(
      autoPan.getByRole("combobox", { name: "Note" }).elements(),
    ).toHaveLength(0);

    // A 0.05 Hz square holds the tone hard right for the clip's 8 s. Left
    // and right averaged, a centered tone at unity in both reads √2 louder
    // than one at √2 in the right alone.
    await typeValue(autoPan, "Rate", "0.05");
    await userEvent.click(shape.getByRole("button", { name: "Square" }));

    await userEvent.click(
      autoPan.getByRole("button", { name: "Bypass Auto Pan" }),
    );
    await expect.poll(level).toBeGreaterThan(0.1);
    const dry = level();

    await userEvent.click(
      autoPan.getByRole("button", { name: "Enable Auto Pan" }),
    );
    await expect.poll(level).toBeLessThan(dry * 0.85);

    // Back in the center at Depth 0 %.
    await typeValue(autoPan, "Depth", "0");
    await expect.poll(level).toBeGreaterThan(dry * 0.9);
  });

  test("a video clip's add menu lists Auto Pan in its Audio group", async () => {
    const dropped = withDroppedMedia(
      EMPTY_PROJECT,
      mediaItem({ kind: "video", hasAudio: true }),
    );
    await render(
      <FxEditor
        project={dropped.project}
        selection={{ source: selectSourceSpan(dropped.span) }}
      />,
    );
    await addFromMenu(
      "Add device to this clip",
      "Volume & Stereo",
      AUTO_PAN_EFFECT_NAME,
      "Audio",
    );
    await expect
      .poll(
        () =>
          [...document.querySelectorAll(CLIP_DEVICES)].filter((panel) =>
            panel.textContent?.includes("Auto Pan"),
          ).length,
      )
      .toBe(1);
  });

  const RENDERS: [string, Record<string, number | string>][] = [
    ["synced", { Sync: "On", Note: "1/4T", Shape: "Triangle" }],
    ["free-running", { Sync: "Off", Rate: 3, Depth: 0.8, Shape: "Square" }],
  ];

  for (const [name, parameters] of RENDERS) {
    test(`the preview's worklet and the export's main-thread chain play ${name} Auto Pan identically`, async () => {
      // Rendering from timeline second 3.25 checks both hosts take the LFO
      // phase from the timeline.
      const difference = await compareHosts(
        effectChain(AUTO_PAN_EFFECT_NAME, parameters),
        { startSeconds: 3.25 },
      );
      // Auto Pan did change the signal, and both hosts agree.
      expect(difference.wet).toBeGreaterThan(0.05);
      expect(difference.max).toBeLessThan(1e-5);
    });
  }
});
