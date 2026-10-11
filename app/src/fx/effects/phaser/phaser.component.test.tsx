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
import { PHASER_EFFECT_NAME, phaserResponseDb } from "./phaser.ts";

// Phaser is added from a clip's add menu, in its Audio group, with its
// controls at their defaults, and notches what the clip sounds like; the
// export's offline render runs it exactly as the chain does, at its
// analytic response when still.

// A 440 Hz tone at 0.3, below the limiter's knee whatever the Phaser does
// to it, through Phaser with `numbers` and `stages` both as an export
// renders it and through a lone chain, with the still sweep's analytic
// level for comparison.
async function renderBoth(numbers: Record<string, number>, stages: string) {
  const url = parityWavUrl((_, t) => 0.3 * Math.sin(2 * Math.PI * 440 * t));
  const stage = parityStage(PHASER_EFFECT_NAME, numbers, { Stages: stages });
  const exported = await exportClip(url, [stage]);
  // The same tone, decoded the same way, through a lone chain.
  const input = await decodeWav(url);
  const direct = runChain([stage], input);
  return {
    difference: maxDifference(exported, direct),
    gainDb: secondHalfGainDb(input, exported),
    expectedDb: phaserResponseDb(
      {
        hz: numbers.Center,
        stages: Number(stages),
        feedback: numbers.Feedback,
        mix: numbers.Mix,
      },
      440,
      PARITY_SAMPLE_RATE,
    ),
  };
}

describe("Phaser", { timeout: 90_000 }, () => {
  test("is added from a clip's Audio menu with its defaults and notches the mix", async () => {
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
      "Modulation & Delay",
      PHASER_EFFECT_NAME,
    );
    await expect.poll(() => devicesIn("clip").length).toBe(2);
    const device = page.elementLocator(devicesIn("clip")[1]);
    await expect.element(device).toHaveAttribute("aria-label", "Phaser");
    await expect
      .element(device.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    expect(
      device.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(0);
    for (const [label, text] of [
      ["Rate", "0.50 Hz"],
      ["Depth", "70%"],
      ["Center", "1.00 kHz"],
      ["Feedback", "30%"],
      ["Mix", "50%"],
    ]) {
      await expect
        .element(device.getByRole("slider", { name: label }))
        .toHaveAttribute("aria-valuetext", text);
    }
    const stages = device.getByRole("group", { name: "Stages" });
    for (const option of ["2", "4", "6", "8", "12"]) {
      await expect
        .element(stages.getByRole("button", { name: option, exact: true }))
        .toHaveAttribute("aria-pressed", option === "4" ? "true" : "false");
    }

    // At Mix 0 the tone plays at its full level.
    await typeValue(device, "Mix", "0");
    await expect
      .element(device.getByRole("slider", { name: "Mix" }))
      .toHaveAttribute("aria-valuetext", "0%");
    await expect.poll(level).toBeGreaterThan(0.02);
    const dry = level();

    // Two still stages notch at Center: centered on the tone, half wet
    // cancels it.
    await userEvent.click(
      stages.getByRole("button", { name: "2", exact: true }),
    );
    await typeValue(device, "Depth", "0");
    await typeValue(device, "Feedback", "0");
    await typeValue(device, "Center", "440");
    await typeValue(device, "Mix", "50");
    await expect
      .element(device.getByRole("slider", { name: "Mix" }))
      .toHaveAttribute("aria-valuetext", "50%");
    await expect.poll(level).toBeLessThan(dry * 0.2);

    // Bypassing it brings the tone back to its full level.
    await userEvent.click(
      device.getByRole("button", { name: "Bypass Phaser" }),
    );
    await expect.poll(level).toBeGreaterThan(dry * 0.8);
  });

  test("a video clip's add menu lists Phaser in its Audio group", async () => {
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
        .getByRole("menuitem", { name: "Modulation & Delay" })
        .elements(),
    ).toHaveLength(0);
    await userEvent.keyboard("{Escape}");
    await addFromMenu(
      "Add device to this clip",
      "Modulation & Delay",
      PHASER_EFFECT_NAME,
      "Audio",
    );
    await expect
      .poll(
        () =>
          document.querySelectorAll(`${CLIP_DEVICES}[aria-label="Phaser"]`)
            .length,
      )
      .toBe(1);
  });

  test("the export's offline render runs Phaser exactly as the chain does", async () => {
    // Sweeping, the export's LFO follows the timeline as the chain's does.
    const swept = await renderBoth(
      { Rate: 2, Depth: 100, Center: 800, Feedback: 60, Mix: 50 },
      "6",
    );
    expect(swept.difference).toBeLessThanOrEqual(1e-5);

    // Still, the level matches the analytic response.
    const still = await renderBoth(
      { Rate: 0.5, Depth: 0, Center: 1000, Feedback: 30, Mix: 50 },
      "4",
    );
    expect(still.difference).toBeLessThanOrEqual(1e-5);
    expect(Math.abs(still.gainDb - still.expectedDb)).toBeLessThan(0.2);
  });
});
