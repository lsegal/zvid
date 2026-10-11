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
import { EQ_EFFECT_NAME, eqResponseDb } from "./eq.ts";

// EQ is added from a clip's add menu, in its Audio group, with its seven
// knobs at their defaults, and shapes what the clip sounds like; the
// export's offline render runs it exactly as the chain does, at its
// analytic response.

// "EQ", not the "EQ & Filter" category that opens its submenu.
const EQ_ITEM = /^EQ(?! & Filter)/;

describe("EQ", { timeout: 90_000 }, () => {
  test("is added from a clip's Audio menu with its defaults and shapes the mix", async () => {
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
    await addFromMenu("Add device to this clip", "EQ & Filter", EQ_ITEM);
    await expect.poll(() => devicesIn("clip").length).toBe(2);
    const device = page.elementLocator(devicesIn("clip")[1]);
    await expect.element(device).toHaveAttribute("aria-label", "EQ");
    await expect
      .element(device.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    expect(
      device.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(0);
    for (const [label, text] of [
      ["Low Freq", "100 Hz"],
      ["Low Gain", "0.0 dB"],
      ["Mid Freq", "1.00 kHz"],
      ["Mid Gain", "0.0 dB"],
      ["Mid Q", "1.00"],
      ["High Freq", "8.00 kHz"],
      ["High Gain", "0.0 dB"],
    ]) {
      await expect
        .element(device.getByRole("slider", { name: label }))
        .toHaveAttribute("aria-valuetext", text);
    }

    await expect.poll(level).toBeGreaterThan(0.02);
    const flat = level();

    // A −15 dB mid band centered on the tone turns it down by about 15 dB;
    // the other bands, far from 440 Hz, barely touch it.
    await typeValue(device, "Mid Freq", "440");
    await typeValue(device, "Mid Gain", "-15");
    await expect
      .element(device.getByRole("slider", { name: "Mid Gain" }))
      .toHaveAttribute("aria-valuetext", "−15.0 dB");
    await expect.poll(level).toBeLessThan(flat * 0.35);

    // Bypassing it brings the tone back to its full level.
    await userEvent.click(device.getByRole("button", { name: "Bypass EQ" }));
    await expect.poll(level).toBeGreaterThan(flat * 0.8);
  });

  test("a video clip's add menu lists EQ in its Audio group", async () => {
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
      EQ_ITEM,
      "Audio",
    );
    await expect
      .poll(
        () =>
          document.querySelectorAll(`${CLIP_DEVICES}[aria-label="EQ"]`).length,
      )
      .toBe(1);
  });

  test("the export's offline render runs EQ exactly as the chain does", async () => {
    // A 440 Hz tone at 0.3, below the limiter's knee whatever the EQ does
    // to it.
    const url = parityWavUrl((_, t) => 0.3 * Math.sin(2 * Math.PI * 440 * t));
    const stage = parityStage(EQ_EFFECT_NAME, {
      "Low Freq": 100,
      "Low Gain": -6,
      "Mid Freq": 440,
      "Mid Gain": 6,
      "Mid Q": 1,
      "High Freq": 8000,
      "High Gain": 4,
    });
    const exported = await exportClip(url, [stage]);
    // The same tone, decoded the same way, through a lone chain.
    const input = await decodeWav(url);
    const direct = runChain([stage], input);
    expect(maxDifference(exported, direct)).toBeLessThanOrEqual(1e-5);
    const expectedDb = eqResponseDb(
      {
        lowFreq: 100,
        lowGain: -6,
        midFreq: 440,
        midGain: 6,
        midQ: 1,
        highFreq: 8000,
        highGain: 4,
      },
      440,
      PARITY_SAMPLE_RATE,
    );
    expect(
      Math.abs(secondHalfGainDb(input, exported) - expectedDb),
    ).toBeLessThan(0.2);
  });
});
