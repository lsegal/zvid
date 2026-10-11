import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { selectSourceSpan } from "../../../app/source-selection.ts";
import type { ProjectState } from "../../../app/types.ts";
import { chainLatencyFrames } from "../../../audio-mix/chain.ts";
import { AUDIO_PROCESSORS } from "../../../audio-mix/processors.ts";
import {
  addFromMenu,
  CLIP_DEVICES,
  devicesIn,
  typeValue,
} from "../../../component-test/fx-actions.ts";
import {
  renderProjectMix,
  rms,
  shareAbove,
  tone,
} from "../../../component-test/fx-audio.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  decodeWav,
  exportClip,
  maxDifference,
  PARITY_LENGTH,
  PARITY_SAMPLE_RATE,
  parityStage,
  parityWavUrl,
  runChain,
} from "../../../component-test/fx-export-parity.ts";
import {
  EMPTY_PROJECT,
  mediaItem,
  withDroppedMedia,
} from "../../../component-test/fx-projects.ts";
import { SATURATION_EFFECT_NAME } from "./saturation.ts";

// Saturation is added from a clip's add menu, in its Audio group, with its
// controls at their defaults, and distorts what the clip sounds like; the
// export's offline render runs it exactly as the chain does.

describe("Saturation", { timeout: 90_000 }, () => {
  test("is added from a clip's Audio menu with its defaults and distorts the mix", async () => {
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
    // The mix's RMS level, and the share of its power above 1 kHz, where
    // the 440 Hz tone has none of its own and only harmonics the effect
    // adds land.
    const reading = () => {
      const mix = renderProjectMix(project, audio, {
        startSeconds: 2,
        seconds: 0.5,
      });
      return { level: rms(mix), harmonics: shareAbove(mix, 48_000, 1000) };
    };

    // An audio clip is offered only audio effects, so its menu needs no
    // Audio heading.
    await addFromMenu(
      "Add device to this clip",
      "Distortion",
      SATURATION_EFFECT_NAME,
    );
    await expect.poll(() => devicesIn("clip").length).toBe(2);
    const device = page.elementLocator(devicesIn("clip")[1]);
    await expect.element(device).toHaveAttribute("aria-label", "Saturation");
    await expect
      .element(device.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    expect(
      device.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(0);
    for (const [label, text] of [
      ["Drive", "6.0 dB"],
      ["Tone", "12.0 kHz"],
      ["Output", "0.0 dB"],
      ["Mix", "100%"],
    ]) {
      await expect
        .element(device.getByRole("slider", { name: label }))
        .toHaveAttribute("aria-valuetext", text);
    }
    const types = device.getByRole("group", { name: "Type" });
    for (const type of ["Soft", "Hard", "Tape", "Tube"]) {
      await expect
        .element(types.getByRole("button", { name: type }))
        .toHaveAttribute("aria-pressed", String(type === "Soft"));
    }

    await expect.poll(() => reading().level).toBeGreaterThan(0.01);
    const clean = reading();

    // Hard at full Drive squares the tone off, so its harmonics carry far
    // more of the mix's power.
    await userEvent.click(types.getByRole("button", { name: "Hard" }));
    await typeValue(device, "Drive", "36");
    await expect
      .element(device.getByRole("slider", { name: "Drive" }))
      .toHaveAttribute("aria-valuetext", "36.0 dB");
    await expect
      .poll(() => reading().harmonics)
      .toBeGreaterThan(Math.max(0.05, clean.harmonics * 10));

    // Output at −24 dB turns the result down by 24 dB.
    const driven = reading();
    await typeValue(device, "Output", "-24");
    await expect.poll(() => reading().level).toBeLessThan(driven.level * 0.2);

    // Bypassing it brings the clean tone back.
    await userEvent.click(
      device.getByRole("button", { name: "Bypass Saturation" }),
    );
    await expect.poll(() => reading().harmonics).toBeLessThan(0.05);
  });

  test("a video clip's add menu lists Saturation in its Audio group", async () => {
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
    await userEvent.click(
      page.getByRole("button", { name: "Add device to this clip" }).first(),
    );
    expect(
      page
        .getByRole("menu")
        .getByRole("group", { name: "Video" })
        .getByRole("menuitem", { name: "Distortion" })
        .elements(),
    ).toHaveLength(0);
    await userEvent.keyboard("{Escape}");
    await addFromMenu(
      "Add device to this clip",
      "Distortion",
      SATURATION_EFFECT_NAME,
      "Audio",
    );
    await expect
      .poll(
        () =>
          document.querySelectorAll(`${CLIP_DEVICES}[aria-label="Saturation"]`)
            .length,
      )
      .toBe(1);
  });

  test("the export's offline render runs Saturation exactly as the chain does", async () => {
    // A 440 Hz tone at 0.2, below the limiter's knee once saturated.
    const url = parityWavUrl((_, t) => 0.2 * Math.sin(2 * Math.PI * 440 * t));
    const stage = parityStage(
      SATURATION_EFFECT_NAME,
      { Drive: 12, Tone: 6000, Output: -3, Mix: 0.8 },
      { Type: "Tube" },
    );
    const exported = await exportClip(url, [stage]);
    // The same tone, decoded the same way, through a lone chain. Export
    // compensates the stage's latency, so it plays that much earlier.
    const latency = chainLatencyFrames(
      AUDIO_PROCESSORS,
      [stage],
      PARITY_SAMPLE_RATE,
    );
    expect(latency).toBeGreaterThan(0);
    const input = await decodeWav(url);
    const direct = runChain([stage], input, PARITY_LENGTH + latency);
    expect(maxDifference(exported, direct, latency)).toBeLessThanOrEqual(1e-5);
    // And it does distort the tone.
    expect(maxDifference(exported, input)).toBeGreaterThan(0.05);
  });
});
