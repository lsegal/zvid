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
  noise,
  renderProjectMix,
  rms,
} from "../../../component-test/fx-audio.ts";
import { SPEC_PEAK } from "../../../component-test/fx-audio-levels.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  mediaItem,
  withDroppedMedia,
} from "../../../component-test/fx-projects.ts";
import { REVERB_EFFECT_NAME } from "./reverb.ts";

// Reverb is added from an audio clip's add menu, shows its defaults, and
// changes what the clip sounds like; the preview's worklet and the export's
// main-thread chain run it identically.

describe("Reverb", { timeout: 90_000 }, () => {
  test("is added to an audio clip with its defaults and changes the mix", async () => {
    // Seeded white noise: broadband, so the reverb's level follows Decay
    // rather than how one frequency meets its modes.
    const item = mediaItem({ kind: "audio", durationSeconds: 8 });
    const audio = new Map([[item.id, noise(8, SPEC_PEAK)]]);
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
      REVERB_EFFECT_NAME,
    );
    await expect.poll(() => devicesIn("clip").length).toBe(2);

    const reverb = page.elementLocator(devicesIn("clip")[1]);
    await expect.element(reverb).toHaveAttribute("aria-label", "Reverb");
    await expect
      .element(reverb.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    expect(
      reverb.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(0);
    for (const [label, text] of [
      ["Decay", "2.00 s"],
      ["Pre-delay", "20 ms"],
      ["Size", "50%"],
      ["Damping", "8.00 kHz"],
      ["Mix", "25%"],
    ]) {
      await expect
        .element(reverb.getByRole("slider", { name: label }))
        .toHaveAttribute("aria-valuetext", text);
    }

    await userEvent.click(
      reverb.getByRole("button", { name: "Bypass Reverb" }),
    );
    await expect.poll(level).toBeGreaterThan(0.1);
    const dry = level();

    // All wet, a short room returns about half the noise's level...
    await userEvent.click(
      reverb.getByRole("button", { name: "Enable Reverb" }),
    );
    await typeValue(reverb, "Mix", "100");
    await typeValue(reverb, "Decay", "0.2");
    await expect
      .element(reverb.getByRole("slider", { name: "Decay" }))
      .toHaveAttribute("aria-valuetext", "0.20 s");
    await expect.poll(level).toBeLessThan(dry * 0.75);
    const short = level();

    // ...and a longer Decay builds up more of it.
    await typeValue(reverb, "Decay", "4");
    await expect.poll(level).toBeGreaterThan(short * 1.3);

    // All dry again at Mix 0 %.
    await typeValue(reverb, "Mix", "0");
    await expect.poll(level).toBeGreaterThan(dry * 0.9);
  });

  test("a video clip's add menu lists Reverb in its Audio group", async () => {
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
      REVERB_EFFECT_NAME,
      "Audio",
    );
    await expect
      .poll(
        () =>
          [...document.querySelectorAll(CLIP_DEVICES)].filter((panel) =>
            panel.textContent?.includes("Reverb"),
          ).length,
      )
      .toBe(1);
  });

  test("the preview's worklet and the export's main-thread chain play Reverb identically", async () => {
    const difference = await compareHosts(
      effectChain(REVERB_EFFECT_NAME, {
        Decay: 1.5,
        "Pre-delay": 30,
        Size: 0.8,
        Damping: 6000,
        Mix: 0.6,
      }),
      { startSeconds: 3.25 },
    );
    // The reverb did change the signal, and both hosts agree.
    expect(difference.wet).toBeGreaterThan(0.05);
    expect(difference.max).toBeLessThan(1e-5);
  });
});
