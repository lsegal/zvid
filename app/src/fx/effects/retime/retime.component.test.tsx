import { afterAll, describe, expect, test } from "vitest";
import { secondsToQuarters } from "../../../app/timeline-math.ts";
import type { ProjectState } from "../../../app/types.ts";
import {
  meanDifference,
  scaledRgb,
} from "../../../component-test/fx-frames.ts";
import {
  EMPTY_PROJECT,
  mediaItem,
  withClipFromSpan,
  withDroppedMedia,
  withEffect,
} from "../../../component-test/fx-projects.ts";
import {
  pixelAt,
  rendererState,
  renderFrame,
} from "../../../component-test/fx-render.ts";
import { clipEffectTrackId } from "../../stack/clip-stacks.ts";

// Retime (#1423): plays a clip's animation at another speed, backwards or
// frozen, and with Blend crossfades each frame into the next. Rendered in
// real WebGL, as export draws its frames, from a Lottie whose ten frames at
// 10 fps step from black toward white, so a frame's gray tells which frame
// of it is drawn.

const PREVIEW = { width: 64, height: 36 };
const FRAMES = 10;
// Frame k's gray level.
const level = (frame: number) => frame * 25;

function steppedLottie() {
  const keyframes = Array.from({ length: FRAMES }, (_, frame) => {
    const value = level(frame) / 255;
    return { t: frame, s: [value, value, value, 1], h: 1 };
  });
  const transform = {
    o: { a: 0, k: 100 },
    r: { a: 0, k: 0 },
    p: { a: 0, k: [8, 8, 0] },
    a: { a: 0, k: [0, 0, 0] },
    s: { a: 0, k: [100, 100, 100] },
  };
  return {
    v: "5.7.0",
    fr: FRAMES,
    ip: 0,
    op: FRAMES,
    w: 16,
    h: 16,
    layers: [
      {
        ty: 4,
        ind: 1,
        ip: 0,
        op: FRAMES,
        st: 0,
        ks: transform,
        shapes: [
          {
            ty: "gr",
            it: [
              {
                ty: "rc",
                p: { a: 0, k: [0, 0] },
                s: { a: 0, k: [32, 32] },
                r: { a: 0, k: 0 },
              },
              { ty: "fl", c: { a: 1, k: keyframes }, o: { a: 0, k: 100 } },
              { ty: "tr", ...transform, p: { a: 0, k: [0, 0] } },
            ],
          },
        ],
      },
    ],
  };
}

const LOTTIE_URL = URL.createObjectURL(
  new Blob([JSON.stringify(steppedLottie())], { type: "application/json" }),
);

afterAll(() => URL.revokeObjectURL(LOTTIE_URL));

// The e2e fixture: a 4 s, 160 × 90 moving test pattern without sound.
const VIDEO = new URL(
  "../../../../e2e/fixtures/test-pattern.mp4",
  import.meta.url,
);

function videoClip() {
  const dropped = withDroppedMedia(
    EMPTY_PROJECT,
    mediaItem({
      kind: "video",
      name: "test-pattern.mp4",
      durationSeconds: 4,
      width: 160,
      height: 90,
      fps: 15,
      previewUrl: VIDEO.href,
      availability: "ready",
    }),
  );
  return withClipFromSpan(dropped.project, dropped.span);
}

// The frame drawn `seconds` into the clip, downsampled to a 16×16 grid of
// RGB values. A new video element can show its first loaded frame before
// its seek lands, so the frame is the one two renders in a row agree on.
async function videoFrameAt(project: ProjectState, seconds: number) {
  const render = async () =>
    scaledRgb(
      await renderFrame(
        rendererState(project, PREVIEW),
        secondsToQuarters(seconds, project.bpm),
      ),
      16,
    );
  let frame = await render();
  for (let tries = 0; tries < 20; tries++) {
    const next = await render();
    if (meanDifference(next, frame) === 0) break;
    frame = next;
  }
  return frame;
}

function lottieClip() {
  const dropped = withDroppedMedia(
    EMPTY_PROJECT,
    mediaItem({
      kind: "image",
      name: "steps.json",
      durationSeconds: 1,
      width: 16,
      height: 16,
      previewUrl: LOTTIE_URL,
      availability: "ready",
    }),
  );
  return withClipFromSpan(dropped.project, dropped.span);
}

// The gray drawn at the preview's center `seconds` into the clip.
async function grayAt(project: ProjectState, seconds: number) {
  const frame = await renderFrame(
    rendererState(project, PREVIEW),
    secondsToQuarters(seconds, project.bpm),
  );
  return pixelAt(frame, PREVIEW.width / 2, PREVIEW.height / 2)[0];
}

function retimed(
  speed: number,
  interpolation = "None",
  { project, clip } = lottieClip(),
) {
  return withEffect(project, clipEffectTrackId(clip.id), "Retime", {
    Speed: speed,
    Interpolation: interpolation,
  }).project;
}

const near = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(3);

describe("Retime", { timeout: 60_000 }, () => {
  test("draws a Lottie's frames at its own speed without a Retime", async () => {
    const { project } = lottieClip();
    near(await grayAt(project, 0.05), level(0));
    near(await grayAt(project, 0.35), level(3));
  });

  test("plays twice as fast at 2×, backwards at -1× and freezes at 0×", async () => {
    // 0.35 s in: frame 7 at 2×; at -1×, 0.35 s before the start, looped
    // to 0.65 s, frame 6; at 0×, the first frame still.
    near(await grayAt(retimed(2), 0.35), level(7));
    near(await grayAt(retimed(-1), 0.35), level(6));
    near(await grayAt(retimed(0), 0.35), level(0));
    // At -1× the frames count down: 0.15 s in is 0.85 s, frame 8.
    near(await grayAt(retimed(-1), 0.15), level(8));
  });

  test("Blend crossfades into the next frame by how far through its frame it is", async () => {
    // 0.375 s at 1× is three quarters of the way from frame 3 to frame 4.
    near(await grayAt(retimed(1, "Blend"), 0.375), level(3.75));
    // None draws frame 3 there, as without a Retime.
    near(await grayAt(retimed(1), 0.375), level(3));
    // At 0.5×, 0.5 s in is 0.25 s: halfway from frame 2 to frame 3.
    near(await grayAt(retimed(0.5, "Blend"), 0.5), level(2.5));
    // At -1×, 0.375 s in is 0.625 s: a quarter of the way from frame 6.
    near(await grayAt(retimed(-1, "Blend"), 0.375), level(6.25));
  });

  test("seeks a video backwards at -1× and holds it at 0×", async () => {
    const plain = videoClip().project;
    // At -1×, 1 s in is 1 s before the media's start, looped to 3 s.
    const reversed = await videoFrameAt(retimed(-1, "None", videoClip()), 1);
    expect(meanDifference(reversed, await videoFrameAt(plain, 3))).toBe(0);
    expect(
      meanDifference(reversed, await videoFrameAt(plain, 1)),
    ).toBeGreaterThan(1);

    const frozen = retimed(0, "None", videoClip());
    expect(
      meanDifference(
        await videoFrameAt(frozen, 2.5),
        await videoFrameAt(plain, 0),
      ),
    ).toBe(0);
  });

  test("blends a video's frame halfway into the next from an element of its own", async () => {
    const plain = videoClip().project;
    // The test pattern runs at 15 fps; halfway through its frame at 1 s.
    const period = 1 / 15;
    const seconds = 1 + period / 2;
    const blended = await videoFrameAt(
      retimed(1, "Blend", videoClip()),
      seconds,
    );
    const from = await videoFrameAt(plain, seconds);
    const to = await videoFrameAt(plain, seconds + period);
    // The pattern moves a little from frame to frame.
    const step = meanDifference(from, to);
    expect(step).toBeGreaterThan(0.5);
    const halfway = from.map((value, index) => (value + to[index]) / 2);
    expect(meanDifference(blended, halfway)).toBeLessThan(step / 5);
  });
});
