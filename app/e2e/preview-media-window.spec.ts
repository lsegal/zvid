import { expect, type Page, test } from "@playwright/test";

// The preview keeps media elements only for video clips near the playhead
// (#949): media off the timeline and audio-only media get none, and a clip's
// element is made shortly before it starts and released after it ends.

type LiveElement = { src: string; tag: string; preload: string };

// The live media elements the renderer holds after syncing to each of
// `playheadsSeconds` in turn, with the playback paused.
async function liveElementsAt(page: Page, playheadsSeconds: number[]) {
  return page.evaluate(async (playheads) => {
    const created: HTMLMediaElement[] = [];
    const createElement = document.createElement.bind(document);
    document.createElement = ((
      tag: string,
      options?: ElementCreationOptions,
    ) => {
      const element = createElement(tag, options);
      if (element instanceof HTMLMediaElement) {
        created.push(element);
      }
      return element;
    }) as typeof document.createElement;

    // A variable keeps TypeScript from resolving the dev server's path.
    const modulePath = "/src/CompositionPlayer.tsx";
    const { CompositionRenderer } = await import(/* @vite-ignore */ modulePath);
    const item = (id: string, kind: "video" | "audio") => ({
      id,
      name: id,
      kind,
      durationSeconds: 60,
      hasAudio: true,
      hasVideo: kind === "video",
      previewUrl: `/missing/${id}`,
    });
    const clip = (id: string, startSeconds: number, seconds: number) => ({
      id,
      sourceTrackId: "",
      laneId: "1",
      label: id,
      mediaPath: "",
      mediaId: id,
      // At 60 BPM a quarter note lasts a second.
      startQ: startSeconds,
      durationSeconds: seconds,
      trimStartSeconds: 0,
      sourceOffsetSeconds: 0,
      sourceWindowStartSeconds: 0,
      sourceWindowEndSeconds: seconds,
      tint: "#000",
      accent: "#fff",
    });
    const renderer = new CompositionRenderer(
      {
        mediaItems: [
          item("first", "video"),
          item("later", "video"),
          item("unused", "video"),
          item("song", "audio"),
        ],
        clips: [clip("first", 0, 4), clip("later", 30, 4), clip("song", 0, 40)],
        lanes: [{ id: "1", name: "Layer 1", colorIndex: 0 }],
        effects: [],
        bpm: 60,
        fps: 30,
        canvasWidth: 90,
        canvasHeight: 160,
      },
      { canvas: createElement("canvas"), audioAnalysis: "offline" },
    );
    const results: LiveElement[][] = [];
    try {
      for (const seconds of playheads) {
        renderer.syncPlayback({
          playheadQ: seconds,
          playheadSeconds: seconds,
          isPlaying: false,
          isScrubbing: false,
          isAudibleScrubbing: false,
          isContinuousScrubbing: false,
        });
        results.push(
          created
            .filter((element) => element.getAttribute("src"))
            .map((element) => ({
              src: element.getAttribute("src") ?? "",
              tag: element.localName,
              preload: element.preload,
            })),
        );
      }
    } finally {
      renderer.destroy();
    }
    return results;
  }, playheadsSeconds);
}

test.beforeEach(async ({ page }) => {
  // Any page of the dev server can import the app's modules.
  await page.goto("/composition-smoke.html");
});

test("only video clips near the playhead get a media element", async ({
  page,
}) => {
  const [start, between, upcoming, playing] = await liveElementsAt(
    page,
    [1, 15, 27, 31],
  );
  const first = { src: "/missing/first", tag: "video", preload: "auto" };
  const later = { src: "/missing/later", tag: "video" };
  // Media off the timeline and the audio-only song get no element.
  expect(start).toEqual([first]);
  expect(between).toEqual([]);
  expect(upcoming).toEqual([{ ...later, preload: "metadata" }]);
  expect(playing).toEqual([{ ...later, preload: "auto" }]);
});
