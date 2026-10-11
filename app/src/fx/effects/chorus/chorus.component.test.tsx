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
  tone,
} from "../../../component-test/fx-audio.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  mediaItem,
  withDroppedMedia,
} from "../../../component-test/fx-projects.ts";
import { CHORUS_EFFECT_NAME } from "./chorus.ts";

// Chorus is added from an audio clip's add menu, shows its defaults, and
// changes what the clip sounds like; the preview's worklet and the export's
// main-thread chain run it identically.

describe("Chorus", () => {
  test("is added to an audio clip with its defaults and changes the mix", async () => {
    const item = mediaItem({ kind: "audio", durationSeconds: 8 });
    const audio = new Map([[item.id, tone(8)]]);
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
    const level = () =>
      rms(renderProjectMix(project, audio, { startSeconds: 2, seconds: 0.5 }));
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
      "Modulation & Delay",
      CHORUS_EFFECT_NAME,
    );
    await expect.poll(() => devicesIn("clip").length).toBe(2);

    const chorus = page.elementLocator(devicesIn("clip")[1]);
    await expect.element(chorus).toHaveAttribute("aria-label", "Chorus");
    await expect
      .element(chorus.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    expect(
      chorus.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(0);
    for (const [label, text] of [
      ["Rate", "0.80 Hz"],
      ["Depth", "50%"],
      ["Delay", "15.0 ms"],
      ["Feedback", "0%"],
      ["Spread", "50%"],
      ["Mix", "50%"],
    ]) {
      await expect
        .element(chorus.getByRole("slider", { name: label }))
        .toHaveAttribute("aria-valuetext", text);
    }

    // Unmodulated, a 17 ms delay puts a 440 Hz tone 7.48 cycles behind
    // itself, so an even mix all but cancels it.
    await typeValue(chorus, "Depth", "0");
    await typeValue(chorus, "Delay", "17");
    await expect
      .element(chorus.getByRole("slider", { name: "Delay" }))
      .toHaveAttribute("aria-valuetext", "17.0 ms");

    await userEvent.click(
      chorus.getByRole("button", { name: "Bypass Chorus" }),
    );
    await expect.poll(level).toBeGreaterThan(0.05);
    const dry = level();

    await userEvent.click(
      chorus.getByRole("button", { name: "Enable Chorus" }),
    );
    await expect.poll(level).toBeLessThan(dry * 0.35);

    // All dry again at Mix 0 %.
    await typeValue(chorus, "Mix", "0");
    await expect.poll(level).toBeGreaterThan(dry * 0.8);
  });

  test("a video clip's add menu lists Chorus in its Audio group", async () => {
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
      CHORUS_EFFECT_NAME,
      "Audio",
    );
    await expect
      .poll(
        () =>
          [...document.querySelectorAll(CLIP_DEVICES)].filter((panel) =>
            panel.textContent?.includes("Chorus"),
          ).length,
      )
      .toBe(1);
  });

  test("the preview's worklet and the export's main-thread chain play Chorus identically", async () => {
    // Rendering from timeline second 3.25 checks both hosts take the LFO
    // phase from the timeline.
    const difference = await compareHosts(
      effectChain(CHORUS_EFFECT_NAME, {
        Rate: 2,
        Depth: 1,
        Feedback: 0.6,
        Spread: 1,
      }),
      { startSeconds: 3.25 },
    );
    // The chorus did change the signal, and both hosts agree.
    expect(difference.wet).toBeGreaterThan(0.05);
    expect(difference.max).toBeLessThan(1e-5);
  });
});
