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
import { TRANSIENT_SHAPER_EFFECT_NAME } from "./transient-shaper.ts";

// Transient Shaper is added from a clip's add menu, after the clip's Gain;
// a video clip's menu lists it in the Audio group. Its Attack and Sustain
// knobs start at 0 % and Output at 0 dB, and it has no Animation modifier.
// Attack moves what the mix plays, and the preview's chain worklet renders
// it as export does.

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

// Adds Transient Shaper to the audio clip from its add menu, after its Gain.
async function addShaper() {
  expect(devicesIn("clip")).toHaveLength(1);
  await addFromMenu(
    "Add device to this clip",
    "Dynamics",
    TRANSIENT_SHAPER_EFFECT_NAME,
  );
  await expect.poll(() => devicesIn("clip").length).toBe(2);
  const [gain, shaper] = devicesIn("clip");
  expect(gain.getAttribute("aria-label")).toBe("Gain");
  expect(shaper.getAttribute("aria-label")).toBe("Transient Shaper");
  return page.elementLocator(shaper);
}

async function press(slider: Locator, key: string) {
  (slider.element() as HTMLElement).focus();
  await userEvent.keyboard(`{${key}}`);
}

describe("Transient Shaper", { timeout: 90_000 }, () => {
  test("adds to an audio clip with its defaults", async () => {
    await renderAudioClip(tone(8));
    const shaper = await addShaper();

    await expect
      .element(shaper.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    expect(
      shaper.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(0);
    const attack = shaper.getByRole("slider", { name: "Attack" });
    const sustain = shaper.getByRole("slider", { name: "Sustain" });
    const output = shaper.getByRole("slider", { name: "Output" });
    await expect.element(attack).toHaveAttribute("aria-valuetext", "0%");
    await expect.element(sustain).toHaveAttribute("aria-valuetext", "0%");
    await expect.element(output).toHaveAttribute("aria-valuetext", "0.0 dB");

    await press(attack, "ArrowUp");
    await expect.element(attack).toHaveAttribute("aria-valuetext", "+1%");
    await press(sustain, "ArrowDown");
    await expect.element(sustain).toHaveAttribute("aria-valuetext", "−1%");

    // Removing it leaves the Gain.
    await userEvent.click(
      shaper.getByRole("button", { name: "Remove Transient Shaper" }),
    );
    await expect.poll(() => devicesIn("clip").length).toBe(1);
    expect(devicesIn("clip")[0].getAttribute("aria-label")).toBe("Gain");
  });

  test("a video clip's add menu lists Transient Shaper in its Audio group", async () => {
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
      TRANSIENT_SHAPER_EFFECT_NAME,
      "Audio",
    );
    await expect.poll(() => devicesIn("clip").length).toBe(1);
    expect(devicesIn("clip")[0].getAttribute("aria-label")).toBe(
      "Transient Shaper",
    );
  });

  test("Attack moves the mix's level", async () => {
    const { media, current } = await renderAudioClip(hits(30));
    const shaper = await addShaper();
    const attack = shaper.getByRole("slider", { name: "Attack" });
    // A second of the hits, once the chain has settled.
    const level = () =>
      rms(renderProjectMix(current(), media, { startSeconds: 2, seconds: 1 }));

    expect(level()).toBeGreaterThan(0.02);
    const flat = level();

    // Offline, +100 % Attack raises these hits by about 8 dB and −100 %
    // lowers them by about 5 dB.
    await press(attack, "End");
    await expect.element(attack).toHaveAttribute("aria-valuetext", "+100%");
    await expect.poll(level).toBeGreaterThan(flat * 1.6);
    await press(attack, "Home");
    await expect.element(attack).toHaveAttribute("aria-valuetext", "−100%");
    await expect.poll(level).toBeLessThan(flat * 0.75);
  });

  test("the preview's chain worklet plays Transient Shaper as export renders it", async () => {
    const shaper = (id: string, attack: number, sustain: number) =>
      effectStage(id, TRANSIENT_SHAPER_EFFECT_NAME, {
        Attack: attack,
        Sustain: sustain,
        Output: -3,
      });
    const result = await compareBusHosts(
      [shaper("clip-shaper", 1, -0.5)],
      [shaper("bus-shaper", -0.4, 0.7)],
    );
    expect(result.shaped).toBeGreaterThan(0.05);
    expect(result.difference).toBeLessThan(1e-5);
  });
});
