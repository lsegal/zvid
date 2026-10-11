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
  meanWindowLevel,
  SPEC_PEAK,
} from "../../../component-test/fx-audio-levels.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  mediaItem,
  withDroppedMedia,
} from "../../../component-test/fx-projects.ts";
import { TREMOLO_EFFECT_NAME } from "./tremolo.ts";

// Tremolo is added from an audio clip's add menu, shows its defaults, and
// changes what the clip sounds like; the preview's worklet and the export's
// main-thread chain run it identically.

describe("Tremolo", { timeout: 90_000 }, () => {
  test("is added to an audio clip with its defaults and changes the mix", async () => {
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
    // The level averaged over a second's short windows, five 5 Hz cycles:
    // a tremolo lowers the average, though its peaks stay at full level.
    const averageLevel = () =>
      meanWindowLevel(
        renderProjectMix(project, audio, { startSeconds: 1, seconds: 1 }),
      );
    expect(devicesIn("clip")).toHaveLength(1);

    await addFromMenu(
      "Add device to this clip",
      "Volume & Stereo",
      TREMOLO_EFFECT_NAME,
    );
    await expect.poll(() => devicesIn("clip").length).toBe(2);

    const tremolo = page.elementLocator(devicesIn("clip")[1]);
    await expect.element(tremolo).toHaveAttribute("aria-label", "Tremolo");
    await expect
      .element(tremolo.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    expect(
      tremolo.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(0);

    // Synced by default: Note shows and Rate hides.
    const sync = tremolo.getByRole("group", { name: "Sync" });
    await expect
      .element(sync.getByRole("button", { name: "On" }))
      .toHaveAttribute("aria-pressed", "true");
    // The whole label, as the e2e spec's toHaveText matched it.
    await expect
      .poll(() =>
        tremolo
          .getByRole("combobox", { name: "Note" })
          .element()
          .textContent?.replace(/\s+/g, " ")
          .trim(),
      )
      .toBe("1/8");
    expect(
      tremolo.getByRole("slider", { name: "Rate" }).elements(),
    ).toHaveLength(0);
    await expect
      .element(tremolo.getByRole("slider", { name: "Depth" }))
      .toHaveAttribute("aria-valuetext", "50%");
    await expect
      .element(
        tremolo
          .getByRole("group", { name: "Shape" })
          .getByRole("button", { name: "Sine" }),
      )
      .toHaveAttribute("aria-pressed", "true");

    // Free-running shows Rate at 5 Hz in place of Note.
    await userEvent.click(sync.getByRole("button", { name: "Off" }));
    await expect
      .element(tremolo.getByRole("slider", { name: "Rate" }))
      .toHaveAttribute("aria-valuetext", "5.0 Hz");
    expect(
      tremolo.getByRole("combobox", { name: "Note" }).elements(),
    ).toHaveLength(0);

    await userEvent.click(
      tremolo.getByRole("button", { name: "Bypass Tremolo" }),
    );
    await expect.poll(averageLevel).toBeGreaterThan(0.1);
    const dry = averageLevel();

    // At full depth the level averages about half the dry level.
    await userEvent.click(
      tremolo.getByRole("button", { name: "Enable Tremolo" }),
    );
    await typeValue(tremolo, "Depth", "100");
    await expect
      .element(tremolo.getByRole("slider", { name: "Depth" }))
      .toHaveAttribute("aria-valuetext", "100%");
    await expect.poll(averageLevel).toBeLessThan(dry * 0.75);

    // And back to the dry level at Depth 0 %.
    await typeValue(tremolo, "Depth", "0");
    await expect.poll(averageLevel).toBeGreaterThan(dry * 0.9);
  });

  test("a video clip's add menu lists Tremolo in its Audio group", async () => {
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
      TREMOLO_EFFECT_NAME,
      "Audio",
    );
    await expect
      .poll(
        () =>
          [...document.querySelectorAll(CLIP_DEVICES)].filter((panel) =>
            panel.textContent?.includes("Tremolo"),
          ).length,
      )
      .toBe(1);
  });

  test("the preview's worklet and the export's main-thread chain play Tremolo identically", async () => {
    // Rendering from timeline second 3.3 checks both hosts take the LFO
    // phase from the timeline.
    for (const parameters of [
      { Sync: "On", Note: "1/16T", Shape: "Square", Depth: 1 },
      { Sync: "Off", Rate: 7, Shape: "Triangle", Depth: 0.8 },
    ] as Record<string, number | string>[]) {
      const difference = await compareHosts(
        effectChain(TREMOLO_EFFECT_NAME, parameters),
        { startSeconds: 3.3 },
      );
      // The tremolo did change the signal, and both hosts agree.
      expect(difference.wet).toBeGreaterThan(0.05);
      expect(difference.max).toBeLessThan(1e-5);
    }
  });
});
