import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import {
  EDITOR_TEST_TIMEOUT,
  type EditorState,
  renderEditor,
} from "../component-test/editor.tsx";
import { center, click } from "../component-test/input.ts";
import { secondsToQuarters } from "../app/timeline-math.ts";
import { usePlayback } from "./usePlayback.ts";

// A MIDI clip has no media, only notes its track's synth plays, so a session
// of only MIDI clips still plays, to the last clip's end (#1383).

describe(usePlayback, { timeout: EDITOR_TEST_TIMEOUT }, () => {
  test("plays a session with only MIDI clips", async () => {
    let state: EditorState | undefined;
    await renderEditor({
      project: {
        bpm: 120,
        sourceTracks: [
          { id: "midi-track", name: "Synth", colorIndex: 0, recordingPaths: [] },
        ],
        sourceSpans: [
          {
            id: "midi-clip",
            sourceTrackId: "midi-track",
            label: "MIDI",
            mediaPath: "",
            startQ: 0,
            durationSeconds: 1,
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
    const { x, y } = center(play.element());
    await click(x, y);

    await expect.poll(() => state?.isPlaying).toBe(true);
    expect(state?.status).not.toBe("No playable source clips on the timeline.");
    // It stops at the clip's end.
    await expect.poll(() => state?.isPlaying, { timeout: 5000 }).toBe(false);
    expect(state?.playheadQ()).toBeCloseTo(secondsToQuarters(1, 120), 1);
  });
});
