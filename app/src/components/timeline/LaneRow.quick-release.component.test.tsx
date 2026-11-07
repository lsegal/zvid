import { beforeEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import {
  EDITOR_TEST_TIMEOUT,
  type EditorState,
  renderEditor,
} from "../../component-test/editor.tsx";
import { center, click, down, move } from "../../component-test/input.ts";
import { setViewport } from "../../component-test/viewport.ts";
import "./LaneRow";

// A lane selection drag keeps its range when the release comes before React
// renders the move that passed the threshold, as on a busy main thread
// (#1607). Only a real click clears the range, seeks and stops playback.

const Y_OFFSET = 20;
const PRESS_OFFSET = 300;

function lane() {
  return document.querySelector<HTMLElement>(
    '[data-timeline-lane-id="1"]',
  ) as HTMLElement;
}

function selections() {
  return document.querySelectorAll<HTMLElement>(".timeline-selection");
}

// A long MIDI clip on a source track lets the transport roll without media,
// and leaves the layer lanes empty.
async function renderLanes() {
  const state: { current?: EditorState } = {};
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
          durationSeconds: 120,
          trimStartSeconds: 0,
          tint: "#000",
          accent: "#fff",
          notes: [{ pitch: 60, start: 0, length: 1, velocity: 100 }],
        },
      ],
    },
    onState: (next) => {
      state.current = next;
    },
  });
  await expect.poll(lane).toBeTruthy();
  return () => {
    if (!state.current) {
      throw new Error("The editor never rendered");
    }
    return state.current;
  };
}

async function startPlayback(state: () => EditorState) {
  const play = page.getByRole("button", { name: "Play timeline" });
  await expect.element(play).toBeVisible();
  const { x, y } = center(play.element());
  await click(x, y);
  await expect.poll(() => state().isPlaying).toBe(true);
}

// Presses the lane and lets React render that. The function it returns sends
// moves, each `dx` from the press, and the release in one task, so React
// can't render any of them first.
async function pressLane() {
  const bounds = lane().getBoundingClientRect();
  const x = bounds.x + PRESS_OFFSET;
  const y = bounds.y + Y_OFFSET;
  let pointerId = 0;
  window.addEventListener(
    "pointerdown",
    (event) => {
      pointerId = event.pointerId;
    },
    { capture: true, once: true },
  );
  await move(x, y);
  await down();
  await expect.poll(() => pointerId).not.toBe(0);
  return (...dxs: number[]) => {
    const pointer = (type: string, dx: number) =>
      window.dispatchEvent(
        new PointerEvent(type, { pointerId, clientX: x + dx, clientY: y }),
      );
    for (const dx of dxs) {
      pointer("pointermove", dx);
    }
    pointer("pointerup", dxs[dxs.length - 1] ?? 0);
  };
}

describe("a lane selection released before its move renders", {
  timeout: EDITOR_TEST_TIMEOUT,
}, () => {
  beforeEach(async () => {
    localStorage.clear();
    await setViewport({ width: 1600, height: 1200 });
  }, 120_000);

  test("keeps the range and leaves the playhead alone", async () => {
    const state = await renderLanes();
    const release = await pressLane();
    release(200);
    await expect.poll(() => selections()).toHaveLength(1);
    expect(selections()[0].getBoundingClientRect().width).toBeGreaterThan(150);
    expect(state().playheadQ()).toBe(0);
  });

  test("keeps playing", async () => {
    const state = await renderLanes();
    await startPlayback(state);
    const release = await pressLane();
    release(200);
    await expect.poll(() => selections()).toHaveLength(1);
    expect(state().isPlaying).toBe(true);
  });

  test("stays a drag when the pointer comes back to the press", async () => {
    const state = await renderLanes();
    const release = await pressLane();
    release(200, 0);
    await expect.poll(() => selections()).toHaveLength(1);
    expect(state().playheadQ()).toBe(0);
  });

  test("is a click when it never passed the threshold", async () => {
    const state = await renderLanes();
    await startPlayback(state);
    const release = await pressLane();
    release(2);
    await expect.poll(() => state().isPlaying).toBe(false);
    expect(selections()).toHaveLength(0);
  });

  test("a real click on empty lane space seeks and stops playback", async () => {
    const state = await renderLanes();
    await startPlayback(state);
    const bounds = lane().getBoundingClientRect();
    await click(bounds.x + PRESS_OFFSET, bounds.y + Y_OFFSET);
    await expect.poll(() => state().isPlaying).toBe(false);
    expect(selections()).toHaveLength(0);
    // Measured stopped: the seek went to the press, past where the short
    // run of playback got to.
    expect(state().playheadQ()).toBeGreaterThan(1);
  });
});
