import { describe, expect, test } from "vitest";
import { type Locator, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { selectSourceSpan } from "../../../app/source-selection.ts";
import type { ProjectState } from "../../../app/types.ts";
import { addFromMenu, devicesIn } from "../../../component-test/fx-actions.ts";
import {
  hits,
  renderProjectMix,
  rms,
  tone,
} from "../../../component-test/fx-audio.ts";
import {
  compareBusHosts,
  effectStage,
} from "../../../component-test/fx-bus-hosts.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  mediaItem,
  withDroppedMedia,
} from "../../../component-test/fx-projects.ts";
import { LIMITER_EFFECT_NAME } from "./limiter.ts";

// Limiter is added from a clip's add menu, after the clip's Gain; a video
// clip's menu lists it in the Audio group. Its knobs start at a −1 dB
// Ceiling, 50 ms Release, 5 ms Lookahead and 0 dB Gain, and it has no
// Animation modifier. Ceiling and Gain move what the mix plays, and the
// preview's chain worklet renders it as export does.

// Renders an audio clip of `audio` with its Gain selected, and returns a
// reader of the project as edited.
async function renderAudioClip(audio: ReturnType<typeof tone>) {
  const item = mediaItem({
    kind: "audio",
    durationSeconds: audio.channels[0].length / audio.sampleRate,
  });
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
  return { media: new Map([[item.id, audio]]), current: () => project };
}

// Adds Limiter to the audio clip from its add menu, after its Gain.
async function addLimiter() {
  expect(devicesIn("clip")).toHaveLength(1);
  await addFromMenu("Add device to this clip", "Dynamics", LIMITER_EFFECT_NAME);
  await expect.poll(() => devicesIn("clip").length).toBe(2);
  const [gain, limiter] = devicesIn("clip");
  expect(gain.getAttribute("aria-label")).toBe("Gain");
  expect(limiter.getAttribute("aria-label")).toBe("Limiter");
  return page.elementLocator(limiter);
}

async function press(slider: Locator, key: string) {
  (slider.element() as HTMLElement).focus();
  await userEvent.keyboard(`{${key}}`);
}

describe("Limiter", { timeout: 90_000 }, () => {
  test("adds to an audio clip with its defaults", async () => {
    await renderAudioClip(tone(8));
    const limiter = await addLimiter();

    await expect
      .element(limiter.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    expect(
      limiter.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(0);
    const ceiling = limiter.getByRole("slider", { name: "Ceiling" });
    const release = limiter.getByRole("slider", { name: "Release" });
    const lookahead = limiter.getByRole("slider", { name: "Lookahead" });
    const gain = limiter.getByRole("slider", { name: "Gain" });
    await expect.element(ceiling).toHaveAttribute("aria-valuetext", "−1.0 dB");
    await expect.element(release).toHaveAttribute("aria-valuetext", "50 ms");
    await expect.element(lookahead).toHaveAttribute("aria-valuetext", "5.0 ms");
    await expect.element(gain).toHaveAttribute("aria-valuetext", "0.0 dB");

    await press(ceiling, "ArrowDown");
    await expect.element(ceiling).toHaveAttribute("aria-valuetext", "−1.1 dB");
    await press(lookahead, "End");
    await expect
      .element(lookahead)
      .toHaveAttribute("aria-valuetext", "10.0 ms");

    // Removing it leaves the Gain.
    await userEvent.click(
      limiter.getByRole("button", { name: "Remove Limiter" }),
    );
    await expect.poll(() => devicesIn("clip").length).toBe(1);
    expect(devicesIn("clip")[0].getAttribute("aria-label")).toBe("Gain");
  });

  test("a video clip's add menu lists Limiter in its Audio group", async () => {
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
      LIMITER_EFFECT_NAME,
      "Audio",
    );
    await expect.poll(() => devicesIn("clip").length).toBe(1);
    expect(devicesIn("clip")[0].getAttribute("aria-label")).toBe("Limiter");
  });

  test("Ceiling and Gain move the mix's level", async () => {
    const { media, current } = await renderAudioClip(hits(30));
    const limiter = await addLimiter();
    const ceiling = limiter.getByRole("slider", { name: "Ceiling" });
    const gain = limiter.getByRole("slider", { name: "Gain" });
    // A second of the hits, once the chain has settled.
    const level = () =>
      rms(renderProjectMix(current(), media, { startSeconds: 2, seconds: 1 }));

    expect(level()).toBeGreaterThan(0.02);
    // The hits peak around −10 dBFS, under the default −1 dB Ceiling.
    const open = level();

    // 24 dB of Gain drives them into the Ceiling, louder than before.
    await press(gain, "End");
    await expect.element(gain).toHaveAttribute("aria-valuetext", "+24.0 dB");
    await expect.poll(level).toBeGreaterThan(open * 1.6);

    // Without the drive, a −20 dB Ceiling holds them about 10 dB down.
    await press(gain, "Home");
    await expect.element(gain).toHaveAttribute("aria-valuetext", "0.0 dB");
    await press(ceiling, "Home");
    await expect.element(ceiling).toHaveAttribute("aria-valuetext", "−20.0 dB");
    await expect.poll(level).toBeLessThan(open * 0.6);
  });

  test("the preview's chain worklet plays Limiter as export renders it", async () => {
    const limiter = (
      id: string,
      ceiling: number,
      lookahead: number,
      gain: number,
    ) =>
      effectStage(id, LIMITER_EFFECT_NAME, {
        Ceiling: ceiling,
        Release: 30,
        Lookahead: lookahead,
        Gain: gain,
      });
    // The worklet chains run uncompensated, so the preview comes out the
    // Limiters' lookaheads (5 ms and 2 ms) late; the offline render
    // compensates them, as the preview mixer does by its timing.
    const result = await compareBusHosts(
      [limiter("clip-limiter", -6, 5, 6)],
      [limiter("bus-limiter", -9, 2, 0)],
      Math.round(0.005 * 48_000) + Math.round(0.002 * 48_000),
    );
    expect(result.shaped).toBeGreaterThan(0.05);
    // The bus Limiter's −9 dB Ceiling holds the driven hits.
    expect(result.loudest).toBeLessThanOrEqual(10 ** (-9 / 20) + 1e-6);
    expect(result.loudest).toBeGreaterThan(10 ** (-9 / 20) * 0.95);
    expect(result.difference).toBeLessThan(1e-5);
  });
});
