import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { selectSourceSpan } from "../../../app/source-selection.ts";
import type { ProjectState } from "../../../app/types.ts";
import {
  addFromMenu,
  CLIP_DEVICES,
  devicesIn,
} from "../../../component-test/fx-actions.ts";
import {
  dominantFrequency,
  renderProjectMix,
  twoPart,
} from "../../../component-test/fx-audio.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  mediaItem,
  withDroppedMedia,
} from "../../../component-test/fx-projects.ts";
import { REVERSE_EFFECT_NAME } from "./reverse.ts";

// The Reverse audio effect: it is added from a clip's Audio add menu, but
// not a track's, with no parameters, and plays the clip's audio backwards:
// a clip whose first half is a low tone and second half a high one starts
// on the high tone. (The export check stays in e2e/reverse.spec.ts.)

const reverseDevice = () =>
  document.querySelectorAll(`${CLIP_DEVICES}[aria-label="Reverse"]`);

describe("Reverse", { timeout: 120_000 }, () => {
  test("a video clip lists Reverse in its add menu's Audio group, and a track doesn't", async () => {
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
      REVERSE_EFFECT_NAME,
      "Audio",
    );
    await expect.poll(() => reverseDevice().length).toBe(1);
  });

  test("Reverse adds with no controls and plays the mix backwards", async () => {
    // Long enough halves to keep each check within one.
    const audio = twoPart(
      24,
      { hz: 300, peak: 10_000 / 32767 },
      { hz: 1500, peak: 10_000 / 32767 },
    );
    const item = mediaItem({ kind: "audio", durationSeconds: 24 });
    const media = new Map([[item.id, audio]]);
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
    // The loudest frequency just after the timeline's start.
    const startTone = () =>
      dominantFrequency(
        renderProjectMix(project, media, { startSeconds: 1, seconds: 0.5 }),
        48_000,
      );
    const near = (hz: number) => () => Math.abs(startTone() - hz) < hz * 0.15;

    // Forwards, it starts on the low tone.
    expect(near(300)()).toBe(true);

    // Added from the clip's add menu, which for a clip with only sound
    // lists the audio effects alone.
    await userEvent.click(
      page.getByRole("button", { name: "Add device to this clip" }).first(),
    );
    expect(
      page.getByRole("menu").getByRole("group", { name: "Video" }).elements(),
    ).toHaveLength(0);
    await userEvent.keyboard("{Escape}");
    await addFromMenu(
      "Add device to this clip",
      "Utility",
      REVERSE_EFFECT_NAME,
    );
    await expect.poll(() => reverseDevice().length).toBe(1);
    const reverse = page.elementLocator(reverseDevice()[0]);
    await expect
      .element(reverse.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    expect(
      reverse.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(0);
    expect(reverse.getByRole("slider").elements()).toHaveLength(0);
    expect(devicesIn("clip")).toHaveLength(2);

    // Reversed, it starts on the high tone.
    await expect.poll(near(1500)).toBe(true);

    // Bypassing it plays forwards again.
    await userEvent.click(
      reverse.getByRole("button", { name: "Bypass Reverse" }),
    );
    await expect.poll(near(300)).toBe(true);
  });
});
