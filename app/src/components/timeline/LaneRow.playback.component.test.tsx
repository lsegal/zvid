import { beforeEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { setViewport } from "../../component-test/viewport.ts";
import "./LaneRow";
import {
  EDITOR_TEST_TIMEOUT,
  type EditorState,
  renderEditor,
} from "../../component-test/editor.tsx";
import { center, click, down, move, up } from "../../component-test/input.ts";

// Drawing, moving and resizing a range selection on a layer's lane leaves
// playback running; only a plain click, which seeks, stops it (#1447).

function lane(id: string) {
  return document.querySelector<HTMLElement>(
    `[data-timeline-lane-id="${id}"]`,
  ) as HTMLElement;
}

function selections() {
  return document.querySelectorAll<HTMLElement>(".timeline-selection");
}

describe("LaneRow during playback", { timeout: EDITOR_TEST_TIMEOUT }, () => {
  beforeEach(async () => {
    localStorage.clear();
    await setViewport({ width: 1600, height: 1200 });
  }, 120_000);

  test("selecting on a lane keeps playing, and a click stops and seeks", async () => {
    let state: EditorState | undefined;
    // A long MIDI clip on a source track keeps the transport rolling
    // without media, and leaves the layer lanes empty.
    await renderEditor({
      project: {
        bpm: 120,
        sourceTracks: [
          {
            id: "midi-track",
            name: "Synth",
            colorIndex: 0,
            recordingPaths: [],
          },
        ],
        sourceSpans: [
          {
            id: "midi-clip",
            sourceTrackId: "midi-track",
            label: "MIDI",
            mediaPath: "",
            startQ: 0,
            durationSeconds: 120,
            trimStartSeconds: 0,
            tint: "#000",
            accent: "#fff",
            notes: [{ pitch: 60, start: 0, length: 1, velocity: 100 }],
          },
        ],
      },
      onState: (next) => {
        state = next;
      },
    });
    const play = page.getByRole("button", { name: "Play timeline" });
    await expect.element(play).toBeVisible();
    const playButton = center(play.element());
    await click(playButton.x, playButton.y);
    await expect.poll(() => state?.isPlaying).toBe(true);

    const bounds = lane("1").getBoundingClientRect();
    const y = bounds.y + 20;

    // Drawing a selection: the overlay tracks the drag and the release
    // commits it, with the transport untouched throughout.
    await move(bounds.x + 300, y);
    await down();
    expect(state?.isPlaying).toBe(true);
    await move(bounds.x + 400, y, { steps: 4 });
    await expect.poll(() => selections()).toHaveLength(1);
    expect(state?.isPlaying).toBe(true);
    await move(bounds.x + 560, y, { steps: 4 });
    await up();
    await expect.poll(() => selections()).toHaveLength(1);
    expect(selections()[0].getBoundingClientRect().width).toBeGreaterThan(200);
    expect(state?.isPlaying).toBe(true);

    // Moving the drawn selection keeps playing too.
    const selectionBox = selections()[0].getBoundingClientRect();
    const grabX = selectionBox.x + selectionBox.width / 2;
    await move(grabX, y);
    await down();
    expect(state?.isPlaying).toBe(true);
    await move(grabX + 80, y, { steps: 4 });
    await up();
    await expect
      .poll(() => selections()[0]?.getBoundingClientRect().x)
      .toBeGreaterThan(selectionBox.x + 40);
    expect(state?.isPlaying).toBe(true);

    // A plain click on empty lane space clears the selection, seeks and
    // stops, as before.
    await click(bounds.x + 100, y);
    await expect.poll(() => state?.isPlaying).toBe(false);
    expect(selections()).toHaveLength(0);
  });
});
