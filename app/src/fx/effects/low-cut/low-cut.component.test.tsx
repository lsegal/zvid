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
  PARITY_SAMPLE_RATE,
  parityStage,
  parityWavUrl,
  runChain,
  secondHalfGainDb,
} from "../../../component-test/fx-export-parity.ts";
import {
  EMPTY_PROJECT,
  mediaItem,
  withDroppedMedia,
} from "../../../component-test/fx-projects.ts";
import { LOW_CUT_EFFECT_NAME, lowCutResponseDb } from "./low-cut.ts";

// Low Cut is added from a clip's add menu, in its Audio group, with its
// controls at their defaults, and cuts what the clip sounds like below its
// cutoff; the export's offline render runs it exactly as the chain does, at its
// analytic response.

describe("Low Cut", { timeout: 90_000 }, () => {
  test("is added from a clip's Audio menu with its defaults and cuts the mix", async () => {
    const item = mediaItem({ kind: "audio", durationSeconds: 8 });
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
      "EQ & Filter",
      LOW_CUT_EFFECT_NAME,
    );
    await expect.poll(() => devicesIn("clip").length).toBe(2);
    const device = page.elementLocator(devicesIn("clip")[1]);
    await expect.element(device).toHaveAttribute("aria-label", "Low Cut");
    await expect
      .element(device.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    expect(
      device.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(0);
    for (const [label, text] of [
      ["Frequency", "80 Hz"],
      ["Resonance", "0.71"],
    ]) {
      await expect
        .element(device.getByRole("slider", { name: label }))
        .toHaveAttribute("aria-valuetext", text);
    }
    const slopes = device.getByRole("group", { name: "Slope" });
    for (const slope of ["12 dB/oct", "24 dB/oct"]) {
      await expect
        .element(slopes.getByRole("button", { name: slope }))
        .toHaveAttribute("aria-pressed", String(slope === "12 dB/oct"));
    }

    // At its default 80 Hz cutoff, the 440 Hz tone passes.
    await expect.poll(level).toBeGreaterThan(0.02);
    const open = level();

    // A cutoff an octave above the tone turns it down by about 12 dB.
    await typeValue(device, "Frequency", "880");
    await expect
      .element(device.getByRole("slider", { name: "Frequency" }))
      .toHaveAttribute("aria-valuetext", "880 Hz");
    await expect.poll(level).toBeLessThan(open * 0.35);
    const cut = level();

    // The steeper slope cuts it by about 24 dB, 12 more.
    await userEvent.click(slopes.getByRole("button", { name: "24 dB/oct" }));
    await expect.poll(level).toBeLessThan(cut * 0.4);

    // Bypassing it brings the tone back to its full level.
    await userEvent.click(
      device.getByRole("button", { name: "Bypass Low Cut" }),
    );
    await expect.poll(level).toBeGreaterThan(open * 0.8);
  });

  test("a video clip's add menu lists Low Cut in its Audio group", async () => {
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
        .getByRole("menuitem", { name: "EQ & Filter" })
        .elements(),
    ).toHaveLength(0);
    await userEvent.keyboard("{Escape}");
    await addFromMenu(
      "Add device to this clip",
      "EQ & Filter",
      LOW_CUT_EFFECT_NAME,
      "Audio",
    );
    await expect
      .poll(
        () =>
          document.querySelectorAll(`${CLIP_DEVICES}[aria-label="Low Cut"]`)
            .length,
      )
      .toBe(1);
  });

  test("the export's offline render runs Low Cut exactly as the chain does", async () => {
    // A 440 Hz tone at 0.3, below the limiter's knee whatever the filter's
    // resonance does to it.
    const url = parityWavUrl((_, t) => 0.3 * Math.sin(2 * Math.PI * 440 * t));
    const stage = parityStage(
      LOW_CUT_EFFECT_NAME,
      { Frequency: 600, Resonance: 2 },
      { Slope: "24 dB/oct" },
    );
    const exported = await exportClip(url, [stage]);
    // The same tone, decoded the same way, through a lone chain.
    const input = await decodeWav(url);
    const direct = runChain([stage], input);
    expect(maxDifference(exported, direct)).toBeLessThanOrEqual(1e-5);
    const expectedDb = lowCutResponseDb(
      { frequency: 600, resonance: 2, slope: "24 dB/oct" },
      440,
      PARITY_SAMPLE_RATE,
    );
    expect(
      Math.abs(secondHalfGainDb(input, exported) - expectedDb),
    ).toBeLessThan(0.2);
  });
});
