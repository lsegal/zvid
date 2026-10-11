import { useState } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { MediaItem } from "../media.ts";
import { clearMediaRange, setMediaRangePoint } from "../media-range.ts";
import { MediaRangeBar, MediaRangeControls } from "./MediaRangeBar";

// In/Out points on media in the Media tab: set with I and O or by dragging
// the markers, shown on the scrub bar and the readout, cleared, and the I
// and O keys scoped to the Media tab. Undo, the Media drawer's badge and
// keeping the range across a reload stay in e2e/media-range.spec.ts. The
// media matches that spec's fixture, a three-second 15 fps test pattern.
const PROJECT_FPS = 30;
const TIME_FORMAT = {
  timelineMode: "timecode",
  bpm: 120,
  signature: { numerator: 4, denominator: 4 },
  fps: PROJECT_FPS,
} as const;

const MEDIA: MediaItem = {
  id: "media-1",
  name: "test-pattern-audio.webm",
  kind: "video",
  durationSeconds: 3,
  fps: 15,
  hasAudio: true,
  hasVideo: true,
  color: "#000",
  accent: "#fff",
  previewUrl: "",
  availability: "ready",
};

// The Media tab's scrub bar and range controls as MediaPreview lays them
// out, with the media's range kept in state as the app keeps it, and a
// stand-in for the timeline beside it.
function MediaTab() {
  const [media, setMedia] = useState(MEDIA);
  const [currentTime, setCurrentTime] = useState(0);
  const setPoint = (point: "in" | "out", seconds: number) =>
    setMedia((item) => setMediaRangePoint(item, point, seconds, PROJECT_FPS));
  return (
    <div className="app-shell">
      <div className="media-preview" tabIndex={-1}>
        <div
          className="media-preview__picture"
          style={{ width: 320, height: 180 }}
        />
        <div className="media-preview__transport">
          <MediaRangeBar
            media={media}
            duration={media.durationSeconds}
            projectFps={PROJECT_FPS}
            onSetPoint={setPoint}
            onSeek={setCurrentTime}
          >
            <input
              type="range"
              className="media-preview__scrub"
              aria-label="Media position"
              min={0}
              max={media.durationSeconds}
              step="any"
              value={currentTime}
              onChange={(event) =>
                setCurrentTime(Number(event.currentTarget.value))
              }
            />
          </MediaRangeBar>
        </div>
        <MediaRangeControls
          media={media}
          currentTime={currentTime}
          timeFormat={TIME_FORMAT}
          onSetPoint={setPoint}
          onClear={() => setMedia(clearMediaRange)}
        />
      </div>
      {/* The timeline handles its own presses without taking focus. */}
      <button type="button" onPointerDown={(event) => event.preventDefault()}>
        Clip
      </button>
    </div>
  );
}

function marker(point: "In" | "Out") {
  return page.getByRole("slider", { name: `Media ${point} point` });
}

function markerSeconds(point: "In" | "Out") {
  return Number(marker(point).element().getAttribute("aria-valuenow"));
}

function dims() {
  return document.querySelectorAll("[data-media-range-dim]");
}

// Moves the media playhead and puts focus back in the Media tab.
async function seekMedia(seconds: number) {
  await userEvent.fill(
    page.getByRole("slider", { name: "Media position" }),
    String(seconds),
  );
  await userEvent.click(
    document.querySelector(".media-preview__picture") as HTMLElement,
  );
}

// Many real presses and a drag, which a busy host makes slow.
test("In/Out points are set, dragged and cleared", {
  timeout: 30_000,
}, async () => {
  const screen = await render(<MediaTab />);
  const readout = screen.getByTestId("media-range-readout");
  const readoutText = () => readout.element().textContent;
  const clear = screen.getByRole("button", { name: "Clear", exact: true });

  // Without a range the whole file is used: nothing dimmed.
  await expect.poll(readoutText).toMatch(/In 00:00:00.*Out 00:03:00/);
  expect(dims()).toHaveLength(0);
  await expect.element(clear).toBeDisabled();

  // I and O set the points at the media playhead.
  await seekMedia(1);
  await userEvent.keyboard("i");
  await seekMedia(2);
  await userEvent.keyboard("o");
  await expect
    .poll(readoutText)
    .toMatch(/In 00:01:00.*Out 00:02:00.*Duration 00:01:00/);
  expect(dims()).toHaveLength(2);
  await expect.poll(() => markerSeconds("In")).toBe(1);
  await expect.poll(() => markerSeconds("Out")).toBe(2);

  // Dragging the Out marker moves it, snapped to a frame.
  const bar = document
    .querySelector(".media-range")
    ?.getBoundingClientRect() as DOMRect;
  await userEvent.dragAndDrop(
    marker("Out"),
    page.elementLocator(document.querySelector(".media-range") as HTMLElement),
    {
      targetPosition: { x: bar.width * (2.5 / 3), y: bar.height / 2 },
    },
  );
  await expect.poll(() => markerSeconds("Out")).toBeCloseTo(2.5, 1);
  const dragged = markerSeconds("Out");
  expect(Math.abs(dragged * 30 - Math.round(dragged * 30))).toBeLessThan(1e-6);

  // Clear goes back to the whole file.
  await clear.click();
  await expect.poll(() => dims().length).toBe(0);
  await expect.poll(readoutText).toMatch(/In 00:00:00.*Out 00:03:00/);
});

test("I and O do nothing outside the Media tab", async () => {
  const screen = await render(<MediaTab />);
  await userEvent.click(
    document.querySelector(".media-preview__picture") as HTMLElement,
  );

  await screen.getByRole("button", { name: "Clip" }).click();
  await userEvent.keyboard("i");
  await userEvent.keyboard("o");
  expect(dims()).toHaveLength(0);
});
