import { describe, expect, test } from "vitest";
import {
  createWebGlResources,
  disposeWebGlResources,
  drawComposition,
} from "./composition-draw.ts";
import { planLayerDraws, resolveSlotScissor } from "./composition-layout.ts";
import { SILENT_AUDIO_BANDS } from "./fx-shaders/audio-bands.ts";
import { resolveEffectChain } from "./fx-shaders/registry.ts";
import { renderStats } from "./render-stats.ts";
import { loadFontFace, resolveFontFace } from "./text-fonts.ts";
import { readTextStyle } from "./text-style.ts";

// The fixtures below are the compositor's inputs reduced to the fields it
// reads, so they're passed through these loose types.
type Layers = Parameters<typeof drawComposition>[2];
type Order = Parameters<typeof drawComposition>[6];
type Effects = Parameters<typeof resolveEffectChain>[0];

describe("drawComposition with an animated Order", () => {
  // While an animated Order moves its slots, layers with effects or
  // Transforms are framed into pooled render targets of bucketed sizes, in
  // the targets' corners, rather than into targets of each frame's exact
  // size. The compositor the preview and the export share is driven in real
  // WebGL through a Squish, once with bucketed targets and once with targets
  // allocated at exactly each picture's size, as they were before pooling,
  // and every pixel of every frame is compared. The GPU filters a texture
  // with fixed-point subtexel weights, which fall on a slightly different
  // grid in a larger texture, so a rare pixel on a steep edge may differ by
  // a few levels; nothing else may.
  test("renders an Order Squish identically with bucketed render targets", async () => {
    // Sides that are not multiples of the 64 px bucket.
    const width = 250;
    const height = 170;
    const frames = 24;
    const text = { ...readTextStyle(undefined), text: "Squish" };
    await loadFontFace(resolveFontFace(text.font, text.weight, text.italic));

    const order = {
      arrangement: "horizontal",
      gridSize: 2,
      spacing: 6,
      slide: { frames, fps: 30, transition: "Squish" },
    } as unknown as Order;
    const effect = (
      trackId: string,
      effectName: string,
      parameters: Record<string, number>,
    ) => ({
      trackId,
      effectName,
      parameters: Object.entries(parameters).map(([key, value]) => ({
        key,
        value: String(value),
        numericValue: value,
      })),
    });
    const effects = [
      effect("lane-0", "Pixelate", { _NumPixels: 0.6 }),
      effect("lane-1", "AnalogGlitch", { _LowMod: 0.8, _HighMod: 0.9 }),
      effect("lane-1", "Colorize", { _HueOffset: 0.3 }),
      effect("lane-2", "Colorize", { _HueOffset: -0.4 }),
      effect("lane-3", "ZoomAndPan", { _End_Zoom: 0.6, _End_X: 0.2 }),
      effect("fx", "NegativeSplit", { _LowIntensity: 0.5 }),
      effect("__group_main", "Colorize", { _HueOffset: 0.1 }),
    ] as unknown as Effects;
    const visual = (rotationDeg = 0) => ({
      opacity: 1,
      scale: 1,
      translateX: 0,
      translateY: 0,
      rotationDeg: 0,
      brightness: 0,
      contrast: 1,
      saturation: 1,
      layoutAnchor: "top",
      transform: {
        positionX: 0.05,
        positionY: -0.03,
        scaleX: 0.9,
        scaleY: 1.1,
        originX: 0,
        originY: 0,
        rotationDeg,
      },
    });
    const gradient = (angleDeg: number) => ({
      kind: "linear",
      angleDeg,
      opacity: 1,
      stops: [
        { offset: 0, color: { r: 255, g: 40, b: 0, a: 1 } },
        { offset: 0.5, color: { r: 20, g: 200, b: 90, a: 1 } },
        { offset: 1, color: { r: 30, g: 60, b: 255, a: 1 } },
      ],
    });
    // Four layers of a 1 s clip, the last entering over its first 24
    // frames, with an FX clip over them all.
    const layers = (frame: number) =>
      [
        ...[
          { fill: gradient(30) },
          { fill: { ...gradient(120), kind: "radial" }, rotationDeg: 17 },
          { text },
          { fill: gradient(250), rotationDeg: -9 },
        ].map((content, lane) => ({
          clip: { startQ: 0, durationSeconds: 4, laneId: `${lane + 1}` },
          media: { id: `clip-${lane}` },
          sourceKey: `clip-${lane}`,
          isInBounds: true,
          laneRank: lane + 1,
          clipProgress: lane === 3 ? frame / 30 / 4 : 0.5,
          visual: visual(content.rotationDeg),
          effectChain: resolveEffectChain(effects, `lane-${lane}`),
          ...content,
        })),
        {
          clip: { startQ: 0 },
          media: { id: "fx" },
          sourceKey: "fx",
          isInBounds: true,
          laneRank: 0,
          clipProgress: 0.5,
          visual: visual(),
          effectChain: resolveEffectChain(effects, "fx"),
          fx: true,
        },
      ] as unknown as Layers;

    const render = (exactTargets: boolean) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const gl = canvas.getContext("webgl", {
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
      });
      if (!gl) throw new Error("WebGL is unavailable.");
      const resources = createWebGlResources(gl);
      resources.effectChain.exactTargets = exactTargets;
      const allocated = renderStats.targetAllocations;
      const pixels: Uint8Array[] = [];
      try {
        for (let frame = 0; frame <= frames; frame++) {
          drawComposition(
            resources,
            { width, height },
            layers(frame),
            new Map(),
            resolveEffectChain(effects, "__group_main"),
            {
              time: frame / 30,
              audio: SILENT_AUDIO_BANDS,
              groupClipProgress: 0.5,
            } as Parameters<typeof drawComposition>[5],
            order,
          );
          const framePixels = new Uint8Array(width * height * 4);
          gl.readPixels(
            0,
            0,
            width,
            height,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            framePixels,
          );
          pixels.push(framePixels);
        }
      } finally {
        disposeWebGlResources(resources);
      }
      return {
        pixels,
        targetsAllocated: renderStats.targetAllocations - allocated,
      };
    };

    const bucketed = render(false);
    const exact = render(true);
    let maxDifference = 0;
    let differingPixels = 0;
    let coloredPixels = 0;
    for (const [frame, pixels] of bucketed.pixels.entries()) {
      const expected = exact.pixels[frame];
      for (let offset = 0; offset < pixels.length; offset += 4) {
        let difference = 0;
        for (let channel = 0; channel < 4; channel++) {
          difference = Math.max(
            difference,
            Math.abs(pixels[offset + channel] - expected[offset + channel]),
          );
        }
        maxDifference = Math.max(maxDifference, difference);
        differingPixels += difference > 0 ? 1 : 0;
        coloredPixels +=
          pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 0 ? 1 : 0;
      }
    }
    // Distinct slot sizes the moving layer was framed at.
    const sizes = new Set<string>();
    for (let frame = 0; frame <= frames; frame++) {
      const step = planLayerDraws(layers(frame), order).find(
        (draw) => draw.type === "layer" && draw.entry.sourceKey === "clip-0",
      );
      if (step?.type !== "layer") {
        throw new Error("The first layer is not drawn.");
      }
      const scissor = resolveSlotScissor(
        step.slot,
        step.slotCount,
        order,
        width,
        height,
        step.motion,
      );
      sizes.add(`${scissor.width}x${scissor.height}`);
    }
    const frameCount = bucketed.pixels.length;

    expect(frameCount).toBe(25);
    // The slots did move: the first layer's changed size most frames.
    expect(sizes.size).toBeGreaterThan(10);
    // Pixels that are not the Order's black border, so a blank canvas can't
    // pass.
    expect(coloredPixels).toBeGreaterThan(frameCount * 250 * 170 * 0.5);
    // Sampling a picture in a pooled target's corner reads the texels a
    // target of the picture's size would hold, up to subtexel rounding.
    expect(maxDifference).toBeLessThanOrEqual(8);
    expect(differingPixels).toBeLessThan(frameCount * 250 * 170 * 0.002);
    // A handful of bucketed targets, rather than new ones every frame.
    expect(bucketed.targetsAllocated).toBeLessThan(30);
    // Fifty frames through every shader in SwiftShader.
  }, 120_000);

  // Push takes a clip in from the side of the arrangement its slot is on:
  // one entering the first column slides in from the left edge, and one
  // entering between others fades in in its slot while they make room.
  // Drawn in real WebGL, so the fade's opacity reaches the composite shader.
  test("pushes a Horizontal Order's clips in by where they enter", () => {
    const width = 300;
    const height = 100;
    const frames = 10;
    const order = {
      arrangement: "horizontal",
      gridSize: 2,
      spacing: 0,
      slide: { frames, fps: 30, transition: "Push" },
    } as unknown as Order;
    const colors = [
      { r: 255, g: 0, b: 0, a: 1 },
      { r: 0, g: 255, b: 0, a: 1 },
      { r: 0, g: 0, b: 255, a: 1 },
    ];
    // Three solid layers of 4 s clips, `moving` entering `frame` frames in
    // and the others halfway through theirs.
    const layers = (moving: number, frame: number) =>
      colors.map((color, lane) => ({
        clip: { startQ: 0, durationSeconds: 4, laneId: `${lane + 1}` },
        media: { id: `fill:clip-${lane}` },
        sourceKey: `fill:clip-${lane}`,
        isInBounds: true,
        laneRank: lane + 1,
        clipProgress: lane === moving ? frame / 30 / 4 : 0.5,
        visual: {
          opacity: 1,
          scale: 1,
          translateX: 0,
          translateY: 0,
          rotationDeg: 0,
          brightness: 0,
          contrast: 1,
          saturation: 1,
          layoutAnchor: "center",
        },
        effectChain: [],
        fill: { kind: "solid", color, opacity: 1 },
      })) as unknown as Layers;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error("WebGL is unavailable.");
    const resources = createWebGlResources(gl);
    // The color at `x`, halfway down, of the frame drawn with `moving`
    // `frame` frames into its entry.
    const sample = (moving: number, frame: number, x: number) => {
      drawComposition(
        resources,
        { width, height },
        layers(moving, frame),
        new Map(),
        [],
        {
          time: frame / 30,
          audio: SILENT_AUDIO_BANDS,
          groupClipProgress: 0.5,
        } as Parameters<typeof drawComposition>[5],
        order,
      );
      const pixel = new Uint8Array(4);
      gl.readPixels(x, height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel];
    };
    let middle: number[][];
    let first: number[][];
    try {
      // The middle column's center, as the green clip enters it.
      middle = Array.from({ length: frames + 1 }, (_, frame) =>
        sample(1, frame, width / 2),
      );
      // Just inside the left edge, as the red clip enters the first column,
      // and halfway through the columns' share it ends with.
      first = [2, 5, frames].map((frame) => sample(0, frame, 1));
    } finally {
      disposeWebGlResources(resources);
    }

    // The green clip fades in from nothing to fully opaque, never sliding:
    // the middle of its slot grows ever greener.
    const greens = middle.map(([, green]) => green);
    expect(greens[0]).toBe(0);
    expect(greens.at(-1)).toBe(255);
    for (let frame = 1; frame < greens.length; frame++) {
      expect(greens[frame]).toBeGreaterThanOrEqual(greens[frame - 1]);
    }
    expect(greens[5]).toBeGreaterThan(40);
    expect(greens[5]).toBeLessThan(215);
    // Once it is in, its neighbors stay clear of its slot's middle.
    for (const [red, , blue] of middle.slice(2)) {
      expect(red + blue).toBe(0);
    }
    // The red clip comes in from the left edge, so it covers the left edge
    // from its first frame in.
    for (const [red, green, blue] of first) {
      expect([red, green, blue]).toEqual([255, 0, 0]);
    }
  });
});
