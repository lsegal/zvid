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
  renderProjectMix,
  rms,
  shareAbove,
  tone,
} from "../../../component-test/fx-audio.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  exportClip,
  maxDifference,
  parityStage,
  parityWavUrl,
  runChain,
} from "../../../component-test/fx-export-parity.ts";
import {
  EMPTY_PROJECT,
  mediaItem,
  withDroppedMedia,
} from "../../../component-test/fx-projects.ts";
import { BITCRUSH_EFFECT_NAME } from "./bitcrush.ts";

// Bitcrush is added from a clip's add menu, in its Audio group, with its
// controls at their defaults, and crushes what the clip sounds like; the
// export's offline render runs it exactly as the chain does.

describe("Bitcrush", { timeout: 90_000 }, () => {
  test("is added from a clip's Audio menu with its defaults and crushes the mix", async () => {
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
    // the 440 Hz tone has none of its own and only the harmonics and
    // images the crush adds land.
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
      BITCRUSH_EFFECT_NAME,
    );
    await expect.poll(() => devicesIn("clip").length).toBe(2);
    const device = page.elementLocator(devicesIn("clip")[1]);
    await expect.element(device).toHaveAttribute("aria-label", "Bitcrush");
    await expect
      .element(device.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    expect(
      device.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(0);
    for (const [label, text] of [
      ["Bits", "8 bits"],
      ["Downsample", "1×"],
      ["Mix", "100%"],
    ]) {
      await expect
        .element(device.getByRole("slider", { name: label, exact: true }))
        .toHaveAttribute("aria-valuetext", text);
    }

    await expect.poll(() => reading().level).toBeGreaterThan(0.01);
    const clean = reading();

    // 1 bit turns the quiet tone into a full-scale square wave: far louder,
    // with odd harmonics carrying much of its power.
    await typeValue(device, "Bits", "1");
    await expect
      .element(device.getByRole("slider", { name: "Bits", exact: true }))
      .toHaveAttribute("aria-valuetext", "1 bit");
    await expect
      .poll(() => reading().harmonics)
      .toBeGreaterThan(Math.max(0.05, clean.harmonics * 5));
    expect(reading().level).toBeGreaterThan(clean.level * 4);

    // At full depth, holding each sample for 64 frames images the tone
    // above 1 kHz.
    await typeValue(device, "Bits", "16");
    await typeValue(device, "Downsample", "64");
    await expect
      .element(device.getByRole("slider", { name: "Downsample", exact: true }))
      .toHaveAttribute("aria-valuetext", "64×");
    await expect
      .poll(() => reading().harmonics)
      .toBeGreaterThan(Math.max(0.05, clean.harmonics * 5));

    // Bypassing it brings the clean tone back.
    await userEvent.click(
      device.getByRole("button", { name: "Bypass Bitcrush" }),
    );
    await expect.poll(() => reading().harmonics).toBeLessThan(0.05);
  });

  test("a video clip's add menu lists Bitcrush in its Audio group", async () => {
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
      BITCRUSH_EFFECT_NAME,
      "Audio",
    );
    await expect
      .poll(
        () =>
          document.querySelectorAll(`${CLIP_DEVICES}[aria-label="Bitcrush"]`)
            .length,
      )
      .toBe(1);
  });

  test("the export's offline render runs Bitcrush exactly as the chain does", async () => {
    // A 440 Hz tone at 0.2.
    const url = parityWavUrl((_, t) => 0.2 * Math.sin(2 * Math.PI * 440 * t));
    // Both stay below the export limiter's knee.
    for (const numbers of [
      { Bits: 3, Downsample: 6, Mix: 0.8 },
      { Bits: 1, Downsample: 1, Mix: 0.5 },
    ]) {
      const stage = parityStage(BITCRUSH_EFFECT_NAME, numbers);
      const exported = await exportClip(url, [stage]);
      // The clip as export reads it, through a lone chain. Export's reading
      // differs from the WAV's samples by rounding error, which the crush
      // would turn into a whole level where a sample sits on a step, so
      // both get the same input.
      const input = await exportClip(url, []);
      const direct = runChain([stage], input);
      expect(maxDifference(exported, direct)).toBeLessThanOrEqual(1e-5);
      // And it does crush the tone.
      expect(maxDifference(exported, input)).toBeGreaterThan(0.05);
    }
  });
});
