import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { selectSourceSpan } from "../../../app/source-selection.ts";
import type { ProjectState } from "../../../app/types.ts";
import {
  addFromMenu,
  CLIP_DEVICES,
  typeValue,
} from "../../../component-test/fx-actions.ts";
import {
  dominantFrequency,
  renderProjectMix,
  tone,
} from "../../../component-test/fx-audio.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  mediaItem,
  withDroppedMedia,
} from "../../../component-test/fx-projects.ts";
import { RE_PITCH_EFFECT_NAME } from "./re-pitch.ts";

// The Re-Pitch audio effect: it is added from a clip's Audio add menu, but
// not a track's, with Semitones and Cents at 0, and shifts the clip's pitch
// by resampling: +12 semitones plays a 440 Hz tone at 880 Hz, −12 at 220 Hz.
// Its Transients and Formants algorithms shift the pitch the same way but
// keep the clip's timing, each showing its own amount.

const rePitchDevice = () =>
  document.querySelectorAll(`${CLIP_DEVICES}[aria-label="Re-Pitch"]`);

describe("Re-Pitch", { timeout: 120_000 }, () => {
  test("a video clip lists Re-Pitch in its add menu's Audio group, and a track doesn't", async () => {
    const dropped = withDroppedMedia(
      EMPTY_PROJECT,
      mediaItem({ kind: "video", hasAudio: false }),
    );
    await render(
      <FxEditor
        project={dropped.project}
        selection={{ source: selectSourceSpan(dropped.span) }}
      />,
    );

    await userEvent.click(
      page.getByRole("button", { name: "Add device to this track" }).first(),
    );
    const trackMenu = page.getByRole("menu");
    await expect
      .element(trackMenu.getByRole("menuitem", { name: "Volume & Stereo" }))
      .toBeVisible();
    expect(
      trackMenu.getByRole("menuitem", { name: "Utility" }).elements(),
    ).toHaveLength(0);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => trackMenu.elements().length).toBe(0);

    await addFromMenu(
      "Add device to this clip",
      "Utility",
      RE_PITCH_EFFECT_NAME,
      "Audio",
    );
    await expect.poll(() => rePitchDevice().length).toBe(1);
  });

  test("Re-Pitch adds at 0 and shifts the mix's pitch by octaves", async () => {
    const item = mediaItem({ kind: "audio", durationSeconds: 24 });
    const media = new Map([[item.id, tone(24, 440, 10_000 / 32767)]]);
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
    // The loudest frequency early in the clip, where even the sped-up clip
    // still plays.
    const pitch = () =>
      dominantFrequency(
        renderProjectMix(project, media, { startSeconds: 2, seconds: 0.5 }),
        48_000,
      );
    const near = (hz: number) => () => Math.abs(pitch() - hz) < hz * 0.05;
    expect(near(440)()).toBe(true);

    await addFromMenu(
      "Add device to this clip",
      "Utility",
      RE_PITCH_EFFECT_NAME,
    );
    await expect.poll(() => rePitchDevice().length).toBe(1);
    const device = page.elementLocator(rePitchDevice()[0]);
    await expect
      .element(device.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    for (const [label, text] of [
      ["Semitones", "0 st"],
      ["Cents", "0 ct"],
    ]) {
      await expect
        .element(device.getByRole("slider", { name: label, exact: true }))
        .toHaveAttribute("aria-valuetext", text);
    }
    // At 0 it passes the tone through.
    expect(near(440)()).toBe(true);

    await typeValue(device, "Semitones", "12");
    await expect
      .element(device.getByRole("slider", { name: "Semitones", exact: true }))
      .toHaveAttribute("aria-valuetext", "+12 st");
    await expect.poll(near(880)).toBe(true);

    await typeValue(device, "Semitones", "-12");
    await expect.poll(near(220)).toBe(true);

    // Bypassing it plays the tone as it was.
    await userEvent.click(
      device.getByRole("button", { name: "Bypass Re-Pitch" }),
    );
    await expect.poll(near(440)).toBe(true);
  });

  test("Transients and Formants shift the pitch and keep the clip playing to its end", async () => {
    const item = mediaItem({ kind: "audio", durationSeconds: 24 });
    const media = new Map([[item.id, tone(24, 440, 10_000 / 32767)]]);
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
    // The loudest frequency late in the clip, which Tape at +12 has run out
    // of by then, or 0 when it is silent.
    const latePitch = () => {
      const late = renderProjectMix(project, media, {
        startSeconds: 20,
        seconds: 0.5,
      });
      return late.some((channel) => channel.some((value) => Math.abs(value) > 1e-4))
        ? dominantFrequency(late, 48_000)
        : 0;
    };
    const near = (hz: number) => () => Math.abs(latePitch() - hz) < hz * 0.05;

    await addFromMenu(
      "Add device to this clip",
      "Utility",
      RE_PITCH_EFFECT_NAME,
    );
    await expect.poll(() => rePitchDevice().length).toBe(1);
    const device = page.elementLocator(rePitchDevice()[0]);
    const algorithm = device.getByRole("group", { name: "Algorithm" });
    await expect
      .element(algorithm.getByRole("button", { name: "Tape" }))
      .toHaveAttribute("aria-pressed", "true");
    for (const amount of ["Transients", "Formants"]) {
      expect(
        device.getByRole("slider", { name: amount, exact: true }).elements(),
      ).toHaveLength(0);
    }

    await typeValue(device, "Semitones", "12");
    await expect.poll(latePitch).toBe(0);

    for (const [shown, hidden] of [
      ["Transients", "Formants"],
      ["Formants", "Transients"],
    ]) {
      await userEvent.click(algorithm.getByRole("button", { name: shown }));
      await expect
        .element(device.getByRole("slider", { name: shown, exact: true }))
        .toHaveAttribute("aria-valuetext", "100%");
      expect(
        device.getByRole("slider", { name: hidden, exact: true }).elements(),
      ).toHaveLength(0);
      await expect.poll(near(880)).toBe(true);
    }
  });
});
