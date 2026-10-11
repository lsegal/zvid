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
import {
  SPEC_PEAK,
  swellingNoise,
} from "../../../component-test/fx-audio-levels.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  mediaItem,
  withDroppedMedia,
} from "../../../component-test/fx-projects.ts";
import { COMPRESSOR_EFFECT_NAME } from "./compressor.ts";

// Compressor is added from an audio clip's add menu, shows its defaults,
// and changes what the clip sounds like; the preview's worklet and the
// export's main-thread chain run it identically.

describe("Compressor", { timeout: 90_000 }, () => {
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
      "Dynamics",
      COMPRESSOR_EFFECT_NAME,
    );
    await expect.poll(() => devicesIn("clip").length).toBe(2);

    const compressor = page.elementLocator(devicesIn("clip")[1]);
    await expect
      .element(compressor)
      .toHaveAttribute("aria-label", "Compressor");
    await expect
      .element(compressor.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    expect(
      compressor.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(0);
    for (const [label, text] of [
      ["Threshold", "−18.0 dB"],
      ["Ratio", "4.0:1"],
      ["Attack", "10.0 ms"],
      ["Release", "100 ms"],
      ["Knee", "6.0 dB"],
      ["Makeup", "0.0 dB"],
      ["Mix", "100%"],
    ]) {
      await expect
        .element(compressor.getByRole("slider", { name: label }))
        .toHaveAttribute("aria-valuetext", text);
    }

    // The tone peaks near −10 dB: 30 dB over a −40 dB Threshold, which 20:1
    // turns down by about 28 dB.
    await typeValue(compressor, "Threshold", "-40");
    await typeValue(compressor, "Ratio", "20");
    await expect
      .element(compressor.getByRole("slider", { name: "Ratio" }))
      .toHaveAttribute("aria-valuetext", "20:1");

    await userEvent.click(
      compressor.getByRole("button", { name: "Bypass Compressor" }),
    );
    await expect.poll(level).toBeGreaterThan(0.1);
    const dry = level();

    await userEvent.click(
      compressor.getByRole("button", { name: "Enable Compressor" }),
    );
    await expect.poll(level).toBeLessThan(dry * 0.15);
    const compressed = level();

    // Makeup brings 24 dB of it back.
    await typeValue(compressor, "Makeup", "24");
    await expect.poll(level).toBeGreaterThan(compressed * 8);
  });

  test("a video clip's add menu lists Compressor in its Audio group", async () => {
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
      "Dynamics",
      COMPRESSOR_EFFECT_NAME,
      "Audio",
    );
    await expect
      .poll(
        () =>
          [...document.querySelectorAll(CLIP_DEVICES)].filter((panel) =>
            panel.textContent?.includes("Compressor"),
          ).length,
      )
      .toBe(1);
  });

  test("the preview's worklet and the export's main-thread chain play Compressor identically", async () => {
    const sampleRate = 48_000;
    const frames = sampleRate * 2;
    const difference = await compareHosts(
      effectChain(COMPRESSOR_EFFECT_NAME, {
        Threshold: -30,
        Ratio: 8,
        Attack: 1,
        Makeup: 6,
        Mix: 0.7,
      }),
      {
        startSeconds: 3.25,
        sampleRate,
        frames,
        input: swellingNoise(frames, sampleRate),
      },
    );
    // The compressor did change the signal, and both hosts agree.
    expect(difference.wet).toBeGreaterThan(0.05);
    expect(difference.max).toBeLessThan(1e-5);
  });
});
