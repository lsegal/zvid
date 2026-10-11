import { expect, test } from "vitest";
import { page } from "vitest/browser";
import type { MediaItem } from "./media";
// The arrangement the wand builds; importing it ties this test to it.
import "./random-arrangement.ts";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
  testPatternVideo,
  withMedia,
} from "./component-test/editor.tsx";

// The arrangement wand builds its video layers from video sources only and
// puts audio-only sources on a separate Audio layer after them. A song that
// runs the whole arrangement becomes one uncut clip there.

// A 440 Hz tone as a 16-bit mono WAV.
function toneWav(seconds: number) {
  const sampleRate = 8000;
  const frames = Math.round(seconds * sampleRate);
  const wav = new DataView(new ArrayBuffer(44 + frames * 2));
  const ascii = (offset: number, text: string) => {
    for (const [index, char] of [...text].entries()) {
      wav.setUint8(offset + index, char.charCodeAt(0));
    }
  };
  ascii(0, "RIFF");
  wav.setUint32(4, wav.byteLength - 8, true);
  ascii(8, "WAVEfmt ");
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 1, true);
  wav.setUint32(24, sampleRate, true);
  wav.setUint32(28, sampleRate * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  ascii(36, "data");
  wav.setUint32(40, frames * 2, true);
  for (let index = 0; index < frames; index++) {
    const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    wav.setInt16(44 + index * 2, Math.round(sample * 10_000), true);
  }
  return new Blob([wav.buffer], { type: "audio/wav" });
}

// A song as the Media drawer adds a dropped WAV.
function song(seconds: number): MediaItem {
  return {
    id: "media-song",
    name: "Song.wav",
    kind: "audio",
    durationSeconds: seconds,
    sampleRate: 8000,
    channels: 1,
    hasAudio: true,
    hasVideo: false,
    color: "#444351",
    accent: "#ff6f9d",
    previewUrl: URL.createObjectURL(toneWav(seconds)),
    availability: "ready",
  };
}

test("the wand adds an Audio layer holding a full-length song uncut", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  // The song outlasts the four-second video. Each was dropped into a new
  // source track.
  await renderEditor({ project: withMedia([testPatternVideo(), song(10)]) });
  await expect
    .poll(() => document.querySelectorAll(".source-span--audio"))
    .toHaveLength(1);
  expect(document.querySelectorAll(".source-span")).toHaveLength(2);

  await page.getByRole("button", { name: "Randomize arrangement" }).click();

  const labels = () => [
    ...document.querySelectorAll<HTMLElement>("[data-lane-label-id]"),
  ];
  await expect
    .poll(() =>
      labels().map((label) => label.querySelector("span")?.textContent),
    )
    .toEqual(["Layer 1", "Layer 2", "Layer 3", "Audio"]);
  const audioLaneId = labels().at(-1)?.getAttribute("data-lane-label-id");
  const audioClips = document.querySelectorAll(
    `[data-timeline-lane-id="${audioLaneId}"] .clip-card`,
  );
  expect(audioClips).toHaveLength(1);
  expect(audioClips[0].className).toMatch(/clip-card--audio/);

  // No video layer holds a clip from the song.
  for (const label of labels().slice(0, -1)) {
    const laneId = label.getAttribute("data-lane-label-id");
    expect(
      document.querySelectorAll(
        `[data-timeline-lane-id="${laneId}"] .clip-card--audio`,
      ),
    ).toHaveLength(0);
  }
});
