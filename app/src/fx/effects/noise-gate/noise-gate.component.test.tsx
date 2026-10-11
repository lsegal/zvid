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
import { NOISE_GATE_EFFECT_NAME } from "./noise-gate.ts";

// Noise Gate is added from a clip's add menu, in its Audio group, with its
// controls at their defaults, and gates what the clip sounds like; the
// export's offline render runs it exactly as the chain does.

describe("Noise Gate", { timeout: 90_000 }, () => {
  test("is added from a clip's Audio menu with its defaults and gates the mix", async () => {
    const item = mediaItem({ kind: "audio", durationSeconds: 8 });
    // A 440 Hz tone at about −10 dBFS.
    const audio = new Map([[item.id, tone(8, 440, 10_000 / 32767)]]);
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

    // An audio clip is offered only audio effects, so its menu needs no
    // Audio heading.
    await addFromMenu(
      "Add device to this clip",
      "Dynamics",
      NOISE_GATE_EFFECT_NAME,
    );
    await expect.poll(() => devicesIn("clip").length).toBe(2);
    const device = page.elementLocator(devicesIn("clip")[1]);
    await expect.element(device).toHaveAttribute("aria-label", "Noise Gate");
    await expect
      .element(device.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    expect(
      device.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(0);
    for (const [label, text] of [
      ["Threshold", "−50.0 dB"],
      ["Attack", "1.0 ms"],
      ["Hold", "20 ms"],
      ["Release", "100 ms"],
      ["Range", "−80.0 dB"],
    ]) {
      await expect
        .element(device.getByRole("slider", { name: label, exact: true }))
        .toHaveAttribute("aria-valuetext", text);
    }

    // The tone is far above the default Threshold, so it plays at its full
    // level.
    await expect.poll(level).toBeGreaterThan(0.02);
    const open = level();

    // With Threshold above the tone, the gate closes and Range silences it.
    await typeValue(device, "Threshold", "0");
    await expect
      .element(device.getByRole("slider", { name: "Threshold", exact: true }))
      .toHaveAttribute("aria-valuetext", "0.0 dB");
    await expect.poll(level).toBeLessThan(open * 0.01);

    // A shallower Range lets the closed gate pass the tone 20 dB down.
    await typeValue(device, "Range", "-20");
    await expect.poll(level).toBeGreaterThan(open * 0.07);
    expect(level()).toBeLessThan(open * 0.14);

    // Bypassing it brings the tone back to its full level.
    await userEvent.click(
      device.getByRole("button", { name: "Bypass Noise Gate" }),
    );
    await expect.poll(level).toBeGreaterThan(open * 0.8);
  });

  test("a video clip's add menu lists Noise Gate in its Audio group", async () => {
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
        .getByRole("menuitem", { name: "Dynamics" })
        .elements(),
    ).toHaveLength(0);
    await userEvent.keyboard("{Escape}");
    await addFromMenu(
      "Add device to this clip",
      "Dynamics",
      NOISE_GATE_EFFECT_NAME,
      "Audio",
    );
    await expect
      .poll(
        () =>
          document.querySelectorAll(`${CLIP_DEVICES}[aria-label="Noise Gate"]`)
            .length,
      )
      .toBe(1);
  });

  test("the export's offline render runs Noise Gate exactly as the chain does", async () => {
    // A 440 Hz tone at −20 dBFS that drops to −60 dBFS halfway through.
    const url = parityWavUrl(
      (index, t) =>
        (index < PARITY_LENGTH / 2 ? 0.1 : 0.001) *
        Math.sin(2 * Math.PI * 440 * t),
    );
    const input = await decodeWav(url);
    for (const range of [-80, -30]) {
      const stage = parityStage(NOISE_GATE_EFFECT_NAME, {
        Threshold: -50,
        Attack: 1,
        Hold: 20,
        Release: 100,
        Range: range,
      });
      const exported = await exportClip(url, [stage]);
      // The same tone, decoded the same way, through a lone chain.
      const direct = runChain([stage], input);
      expect(maxDifference(exported, direct)).toBeLessThanOrEqual(1e-5);

      // The gain in dB over frames `from` to `to`.
      const gainDb = (from: number, to: number) => {
        let inTotal = 0;
        let outTotal = 0;
        for (let index = from; index < to; index++) {
          inTotal += input[index] * input[index];
          outTotal += exported[index] * exported[index];
        }
        return 10 * Math.log10(outTotal / inTotal);
      };
      // Open, the loud half passes unchanged; closed, the quiet half drops
      // by Range.
      const loudDb = gainDb(PARITY_SAMPLE_RATE / 4, PARITY_LENGTH / 2);
      const quietDb = gainDb(
        PARITY_LENGTH / 2 + PARITY_SAMPLE_RATE / 2,
        PARITY_LENGTH,
      );
      expect(Math.abs(loudDb)).toBeLessThan(0.01);
      expect(Math.abs(quietDb - range)).toBeLessThan(0.5);
    }
  });
});
