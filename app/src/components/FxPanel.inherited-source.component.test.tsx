import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { FxEditor } from "../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  mediaItem,
  withClipFromSpan,
  withDroppedMedia,
  withEffect,
} from "../component-test/fx-projects.ts";
import {
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "../fx/stack/clip-stacks.ts";

// A layer clip's Clip section lists the source effects it inherits, ahead
// of its own and read-only: they are edited on the source.

// A video's source clip with a Colorize and an off Pixelate, its track with
// a Reverb, and a layer clip made from it.
function inheritingProject() {
  const dropped = withDroppedMedia(
    EMPTY_PROJECT,
    mediaItem({ kind: "video", hasAudio: true }),
  );
  const { span } = dropped;
  let project = withEffect(
    dropped.project,
    sourceClipEffectTrackId(span.id),
    "Colorize",
  ).project;
  const pixelate = withEffect(
    project,
    sourceClipEffectTrackId(span.id),
    "Pixelate",
  );
  project = {
    ...pixelate.project,
    effects: pixelate.project.effects.map((effect) =>
      effect.id === pixelate.effectId ? { ...effect, enabled: false } : effect,
    ),
  };
  project = withEffect(
    project,
    sourceTrackEffectTrackId(span.sourceTrackId),
    "Reverb",
  ).project;
  return withClipFromSpan(project, span);
}

const inheritedSection = () =>
  document.querySelector('section[aria-label="Inherited from source"]');

describe("FX panel inherited source effects", { timeout: 60_000 }, () => {
  test("lists the source track's and source clip's effects in the Clip section", async () => {
    const { project, clip } = inheritingProject();
    await render(
      <FxEditor
        project={project}
        selection={{ laneId: clip.laneId, clipId: clip.id }}
      />,
    );

    await expect.poll(inheritedSection).not.toBeNull();
    const section = inheritedSection() as HTMLElement;
    const stacks = [...section.querySelectorAll("ul")].map((list) => [
      list.getAttribute("aria-label"),
      [...list.querySelectorAll("li")].map((item) =>
        (item.textContent ?? "").trim(),
      ),
    ]);
    const track = project.sourceTracks[0];
    expect(stacks).toEqual([
      [`${track.name} effects`, ["Reverb"]],
      // Its 0 dB Gain, as every source clip with sound gets.
      [`${clip.label} effects`, ["Gain", "Colorize", "Pixelate (off)"]],
    ]);
    // It sits in the Clip section, ahead of the clip's own Gain.
    const clipDivider = document.querySelector('[data-fx-divider="clip"]');
    const gain = document.querySelector('section[aria-label="Gain"]');
    expect(clipDivider).not.toBeNull();
    expect(gain).not.toBeNull();
    expect(
      (clipDivider as Element).compareDocumentPosition(section) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      section.compareDocumentPosition(gain as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Read-only: nothing in it can be pressed or changed.
    expect(
      section.querySelectorAll("button, input, [role=slider]"),
    ).toHaveLength(0);
  });

  test("is absent when the layer itself is selected", async () => {
    const { project, clip } = inheritingProject();
    await render(
      <FxEditor project={project} selection={{ laneId: clip.laneId }} />,
    );

    await expect
      .poll(() => document.querySelector('[data-fx-divider="layer"]'))
      .not.toBeNull();
    expect(inheritedSection()).toBeNull();
  });
});
