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
  rms,
} from "../../../component-test/fx-audio.ts";
import { bursts } from "../../../component-test/fx-audio-levels.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  mediaItem,
  withDroppedMedia,
} from "../../../component-test/fx-projects.ts";
import { DELAY_EFFECT_NAME } from "./delay.ts";

// Delay is added from an audio clip's add menu, shows its defaults, and
// changes what the clip sounds like; the preview's worklet and the export's
// main-thread chain run it identically.

describe("Delay", { timeout: 90_000 }, () => {
  test("is added to an audio clip with its defaults and changes the mix", async () => {
    // 440 Hz bursts, 50 ms every 500 ms.
    const item = mediaItem({ kind: "audio", durationSeconds: 8 });
    const audio = new Map([[item.id, bursts(8)]]);
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
    // The RMS level over four whole burst periods, a second into the clip:
    // echoes fill the gaps between the bursts and raise it.
    const averageLevel = () =>
      rms(renderProjectMix(project, audio, { startSeconds: 1, seconds: 2 }));
    expect(devicesIn("clip")).toHaveLength(1);

    await addFromMenu(
      "Add device to this clip",
      "Modulation & Delay",
      DELAY_EFFECT_NAME,
    );
    await expect.poll(() => devicesIn("clip").length).toBe(2);

    const delay = page.elementLocator(devicesIn("clip")[1]);
    await expect.element(delay).toHaveAttribute("aria-label", "Delay");
    await expect
      .element(delay.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    expect(
      delay.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(0);

    // Synced by default: Note shows and Time hides.
    const sync = delay.getByRole("group", { name: "Sync" });
    await expect
      .element(sync.getByRole("button", { name: "On" }))
      .toHaveAttribute("aria-pressed", "true");
    // The whole label, as the e2e spec's toHaveText matched it.
    await expect
      .poll(() =>
        delay
          .getByRole("combobox", { name: "Note" })
          .element()
          .textContent?.replace(/\s+/g, " ")
          .trim(),
      )
      .toBe("1/8D");
    expect(delay.getByRole("slider", { name: "Time" }).elements()).toHaveLength(
      0,
    );
    await expect
      .element(delay.getByRole("slider", { name: "Feedback" }))
      .toHaveAttribute("aria-valuetext", "35%");
    await expect
      .element(
        delay
          .getByRole("group", { name: "Ping-pong" })
          .getByRole("button", { name: "Off" }),
      )
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(delay.getByRole("slider", { name: "High cut" }))
      .toHaveAttribute("aria-valuetext", "8.00 kHz");
    await expect
      .element(delay.getByRole("slider", { name: "Mix" }))
      .toHaveAttribute("aria-valuetext", "30%");

    // Free-running shows Time at 375 ms in place of Note.
    await userEvent.click(sync.getByRole("button", { name: "Off" }));
    await expect
      .element(delay.getByRole("slider", { name: "Time" }))
      .toHaveAttribute("aria-valuetext", "375 ms");
    expect(
      delay.getByRole("combobox", { name: "Note" }).elements(),
    ).toHaveLength(0);

    await userEvent.click(delay.getByRole("button", { name: "Bypass Delay" }));
    await expect.poll(averageLevel).toBeGreaterThan(0.02);
    const dry = averageLevel();

    // Fully wet with 90 % feedback, the repeats fill the gaps between the
    // bursts and the average level rises well above the dry level.
    await userEvent.click(delay.getByRole("button", { name: "Enable Delay" }));
    await typeValue(delay, "Time", "100");
    await typeValue(delay, "Mix", "1");
    await typeValue(delay, "Feedback", "0.9");
    await expect
      .element(delay.getByRole("slider", { name: "Feedback" }))
      .toHaveAttribute("aria-valuetext", "90%");
    await expect.poll(averageLevel).toBeGreaterThan(dry * 1.5);

    // With no feedback, one repeat replaces each burst: back near the dry
    // level.
    await typeValue(delay, "Feedback", "0");
    await expect.poll(averageLevel).toBeLessThan(dry * 1.2);
  });

  test("a video clip's add menu lists Delay in its Audio group", async () => {
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
      "Modulation & Delay",
      DELAY_EFFECT_NAME,
      "Audio",
    );
    await expect
      .poll(
        () =>
          [...document.querySelectorAll(CLIP_DEVICES)].filter((panel) =>
            panel.textContent?.includes("Delay"),
          ).length,
      )
      .toBe(1);
  });

  test("the preview's worklet and the export's main-thread chain play Delay identically", async () => {
    // Rendering from timeline second 3.3 checks both hosts agree away from
    // the timeline's start.
    for (const parameters of [
      {
        Sync: "On",
        Note: "1/16D",
        Feedback: 0.8,
        "Ping-pong": "On",
        "High cut": 3000,
        Mix: 0.5,
      },
      {
        Sync: "Off",
        Time: 123.4,
        Feedback: 0.6,
        "Ping-pong": "Off",
        "High cut": 12000,
        Mix: 0.7,
      },
    ] as Record<string, number | string>[]) {
      const difference = await compareHosts(
        effectChain(DELAY_EFFECT_NAME, parameters),
        { startSeconds: 3.3 },
      );
      // The delay did change the signal, and both hosts agree.
      expect(difference.wet).toBeGreaterThan(0.05);
      expect(difference.max).toBeLessThan(1e-5);
    }
  });
});
