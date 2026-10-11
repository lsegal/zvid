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
  sibilant,
} from "../../../component-test/fx-audio.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  decodeWav,
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
import { DE_ESS_EFFECT_NAME } from "./de-ess.ts";

// De-ess is added from a clip's add menu, in its Audio group, with its
// controls at their defaults, and turns down the sibilant band of what the
// clip sounds like; the export's offline render runs it exactly as the
// chain does.

describe("De-ess", { timeout: 90_000 }, () => {
  test("is added from a clip's Audio menu with its defaults and turns down sibilance", async () => {
    const item = mediaItem({ kind: "audio", durationSeconds: 8 });
    const audio = new Map([[item.id, sibilant(8)]]);
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
    // The mix's RMS level, and the share of its power above 3 kHz, where
    // only the 6 kHz "sibilance" of the test sound lies.
    const reading = () => {
      const mix = renderProjectMix(project, audio, {
        startSeconds: 2,
        seconds: 0.5,
      });
      return { level: rms(mix), sibilance: shareAbove(mix, 48_000, 3000) };
    };

    // An audio clip is offered only audio effects, so its menu needs no
    // Audio heading.
    await addFromMenu(
      "Add device to this clip",
      "Dynamics",
      DE_ESS_EFFECT_NAME,
    );
    await expect.poll(() => devicesIn("clip").length).toBe(2);
    const device = page.elementLocator(devicesIn("clip")[1]);
    await expect.element(device).toHaveAttribute("aria-label", "De-ess");
    await expect
      .element(device.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    expect(
      device.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(0);
    for (const [label, text] of [
      ["Frequency", "6.00 kHz"],
      ["Threshold", "−20.0 dB"],
      ["Amount", "6.0 dB"],
    ]) {
      await expect
        .element(device.getByRole("slider", { name: label }))
        .toHaveAttribute("aria-valuetext", text);
    }
    const listen = device.getByRole("group", { name: "Listen" });
    for (const option of ["Off", "On"]) {
      await expect
        .element(listen.getByRole("button", { name: option }))
        .toHaveAttribute("aria-pressed", String(option === "Off"));
    }

    // At its defaults the 6 kHz tone sits at Threshold, so nothing changes:
    // about half the mix's power is sibilance.
    await expect.poll(() => reading().level).toBeGreaterThan(0.01);
    const clean = reading();
    expect(clean.sibilance).toBeGreaterThan(0.3);

    // 40 dB over Threshold, it takes the full 24 dB off the 6 kHz tone.
    await typeValue(device, "Threshold", "-60");
    await typeValue(device, "Amount", "24");
    await expect
      .element(device.getByRole("slider", { name: "Amount" }))
      .toHaveAttribute("aria-valuetext", "24.0 dB");
    await expect
      .poll(() => reading().sibilance)
      .toBeLessThan(clean.sibilance * 0.1);

    // Listen solos the detection band, so the 300 Hz tone drops out.
    await userEvent.click(listen.getByRole("button", { name: "On" }));
    await expect.poll(() => reading().sibilance).toBeGreaterThan(0.9);

    // Bypassing it brings the untouched mix back.
    await userEvent.click(
      device.getByRole("button", { name: "Bypass De-ess" }),
    );
    await expect
      .poll(() => Math.abs(reading().sibilance - clean.sibilance))
      .toBeLessThan(0.1);
  });

  test("a video clip's add menu lists De-ess in its Audio group", async () => {
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
      DE_ESS_EFFECT_NAME,
      "Audio",
    );
    await expect
      .poll(
        () =>
          document.querySelectorAll(`${CLIP_DEVICES}[aria-label="De-ess"]`)
            .length,
      )
      .toBe(1);
  });

  test("the export's offline render runs De-ess exactly as the chain does", async () => {
    // A 300 Hz tone with a 6 kHz tone that swells in and out, so the
    // reduction moves.
    const url = parityWavUrl((_, t) => {
      const swell = 0.5 - 0.5 * Math.cos(2 * Math.PI * 2 * t);
      return (
        0.2 * Math.sin(2 * Math.PI * 300 * t) +
        0.3 * swell * Math.sin(2 * Math.PI * 6000 * t)
      );
    });
    const stage = parityStage(
      DE_ESS_EFFECT_NAME,
      { Frequency: 6000, Threshold: -30, Amount: 12 },
      { Listen: "Off" },
    );
    const exported = await exportClip(url, [stage]);
    // The same sound, decoded the same way, through a lone chain.
    const input = await decodeWav(url);
    const direct = runChain([stage], input);
    expect(maxDifference(exported, direct)).toBeLessThanOrEqual(1e-5);
    // And it does turn the 6 kHz swell down.
    expect(maxDifference(exported, input)).toBeGreaterThan(0.05);
  });
});
