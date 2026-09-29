// drawComposition drives WebGL and reads HTML media elements.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  type CompositeLayer,
  createWebGlResources,
  drawComposition,
  type WebGlResources,
} from "./composition-draw.ts";
import {
  resolveBandScissor,
  resolveCanvasBounds,
  resolveLayerPlacement,
  resolveSlotScissor,
} from "./composition-layout.ts";
import {
  type CompositionOrder,
  DEFAULT_COMPOSITION_ORDER,
  Z_ORDER_COMPOSITION,
} from "./composition-order.ts";
import {
  frameBoxInCanvas,
  IDENTITY_TRANSFORM,
  type LayerTransform,
  matrixQuadAxes,
  nestedTransformMatrix,
  transformedQuadAxes,
} from "./composition-transform.ts";
import type { FillPaint } from "./fill-paint.ts";
import { SILENT_AUDIO_BANDS } from "./fx-shaders/audio-bands.ts";
import { POSITION_ATTRIBUTE_LOCATION } from "./fx-shaders/gl.ts";
import { type ChainEffect, resolveEffectChain } from "./fx-shaders/registry.ts";
import { readTextStyle, type TextStyle } from "./text-style.ts";

const WIDTH = 360;
const HEIGHT = 640;

type Handle = { kind: string; id: number };
type ScissorBox = [number, number, number, number];

type DrawCall = {
  program: Handle | null;
  framebuffer: Handle | null;
  arrayBuffer: Handle | null;
  attribute: { enabled: boolean; buffer: Handle | null; size: number } | null;
  blend: boolean;
  blendFunc: [string, string] | null;
  scissorTest: boolean;
  scissor: ScissorBox | null;
  viewport: ScissorBox | null;
  activeTexture: string | null;
  texture: Handle | null;
  // uAxisX, uAxisY and uOffset of the composite program.
  axes: Record<string, [number, number]>;
};

// A WebGLRenderingContext stand-in that tracks the state drawComposition and
// the effect chain rely on and snapshots it at every draw. Constants resolve
// to their own names, and calls it doesn't model are accepted and ignored.
function createRecordingGl() {
  let nextId = 1;
  const handle = (kind: string): Handle => ({ kind, id: nextId++ });
  const state = {
    program: null as Handle | null,
    framebuffer: null as Handle | null,
    arrayBuffer: null as Handle | null,
    attributes: new Map<
      number,
      { enabled: boolean; buffer: Handle | null; size: number }
    >(),
    enabled: new Set<string>(),
    blendFunc: null as [string, string] | null,
    scissor: null as ScissorBox | null,
    viewport: null as ScissorBox | null,
    activeTexture: "TEXTURE0" as string | null,
    textures: new Map<string, Handle | null>(),
    uniforms: {} as Record<string, [number, number]>,
  };
  const draws: DrawCall[] = [];
  // Arguments of every texImage2D call.
  const uploads: unknown[][] = [];
  const attribute = (index: number) => {
    let entry = state.attributes.get(index);
    if (!entry) {
      entry = { enabled: false, buffer: null, size: 0 };
      state.attributes.set(index, entry);
    }
    return entry;
  };
  const methods: Record<string, (...args: never[]) => unknown> = {
    createBuffer: () => handle("buffer"),
    createTexture: () => handle("texture"),
    createFramebuffer: () => handle("framebuffer"),
    createShader: () => handle("shader"),
    createProgram: () => handle("program"),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getAttribLocation: () => POSITION_ATTRIBUTE_LOCATION,
    getUniformLocation: (_program: Handle, name: string) => ({ name }),
    checkFramebufferStatus: () => "FRAMEBUFFER_COMPLETE",
    getParameter: () => 4096,
    useProgram: (program: Handle) => {
      state.program = program;
    },
    bindFramebuffer: (_target: string, framebuffer: Handle | null) => {
      state.framebuffer = framebuffer;
    },
    bindBuffer: (_target: string, buffer: Handle | null) => {
      state.arrayBuffer = buffer;
    },
    enableVertexAttribArray: (index: number) => {
      attribute(index).enabled = true;
    },
    disableVertexAttribArray: (index: number) => {
      attribute(index).enabled = false;
    },
    vertexAttribPointer: (index: number, size: number) => {
      const entry = attribute(index);
      entry.buffer = state.arrayBuffer;
      entry.size = size;
    },
    enable: (capability: string) => {
      state.enabled.add(capability);
    },
    disable: (capability: string) => {
      state.enabled.delete(capability);
    },
    blendFunc: (source: string, destination: string) => {
      state.blendFunc = [source, destination];
    },
    scissor: (...box: ScissorBox) => {
      state.scissor = box;
    },
    viewport: (...box: ScissorBox) => {
      state.viewport = box;
    },
    activeTexture: (unit: string) => {
      state.activeTexture = unit;
    },
    bindTexture: (_target: string, texture: Handle | null) => {
      state.textures.set(state.activeTexture ?? "", texture);
    },
    texImage2D: (...args: never[]) => {
      uploads.push(args);
    },
    uniform2f: (location: { name: string }, x: number, y: number) => {
      state.uniforms[location.name] = [x, y];
    },
    drawArrays: () => {
      draws.push({
        program: state.program,
        framebuffer: state.framebuffer,
        arrayBuffer: state.arrayBuffer,
        attribute: state.attributes.has(POSITION_ATTRIBUTE_LOCATION)
          ? { ...attribute(POSITION_ATTRIBUTE_LOCATION) }
          : null,
        blend: state.enabled.has("BLEND"),
        blendFunc: state.blendFunc,
        scissorTest: state.enabled.has("SCISSOR_TEST"),
        scissor: state.scissor,
        viewport: state.viewport,
        activeTexture: state.activeTexture,
        texture: state.textures.get(state.activeTexture ?? "") ?? null,
        axes: {
          uAxisX: state.uniforms.uAxisX,
          uAxisY: state.uniforms.uAxisY,
          uOffset: state.uniforms.uOffset,
        },
      });
    },
  };
  const gl = new Proxy(methods, {
    get(target, property) {
      if (typeof property !== "string") return undefined;
      if (property in target) return target[property];
      if (/^[A-Z0-9_]+$/.test(property)) return property;
      return () => undefined;
    },
  }) as unknown as WebGLRenderingContext;

  return {
    gl,
    draws,
    uploads,
    // Simulates another caller leaving unrelated vertex state behind.
    scramble() {
      state.program = handle("program");
      state.arrayBuffer = handle("buffer");
      attribute(POSITION_ATTRIBUTE_LOCATION).buffer = state.arrayBuffer;
      state.enabled.delete("BLEND");
      state.activeTexture = "TEXTURE3";
    },
  };
}

class FakeVideo {
  readyState = 4;
  videoWidth: number;
  videoHeight: number;

  constructor(width: number, height: number) {
    this.videoWidth = width;
    this.videoHeight = height;
  }
}

const globals = globalThis as Record<string, unknown>;
let savedGlobals: Record<string, unknown> = {};

beforeEach(() => {
  savedGlobals = {
    HTMLVideoElement: globals.HTMLVideoElement,
    HTMLMediaElement: globals.HTMLMediaElement,
  };
  globals.HTMLVideoElement = FakeVideo;
  globals.HTMLMediaElement = { HAVE_CURRENT_DATA: 2 };
});

afterEach(() => {
  Object.assign(globals, savedGlobals);
});

function colorize(trackId: string): ChainEffect {
  return {
    trackId,
    effectName: "Colorize",
    parameters: [{ key: "_HueOffset", value: "0.25", numericValue: 0.25 }],
  };
}

function layers(
  count: number,
  effects: ChainEffect[],
  sharedMedia = false,
  transforms: Array<LayerTransform | undefined> = [],
  clipTransforms: Array<LayerTransform | undefined> = [],
) {
  return Array.from({ length: count }, (_, lane) => {
    const layer: CompositeLayer = {
      clip: { startQ: 0 },
      media: {
        id: sharedMedia ? "media" : `media-${lane}`,
        width: 1080,
        height: 1920,
      },
      sourceKey: `media-${lane}`,
      isInBounds: true,
      laneRank: lane,
      clipProgress: 0.5,
      visual: {
        opacity: 1,
        scale: 1,
        translateX: 0,
        translateY: 0,
        rotationDeg: 0,
        brightness: 0,
        contrast: 1,
        saturation: 1,
        layoutAnchor: "top",
        transform: transforms[lane],
        clipTransform: clipTransforms[lane],
      },
      effectChain: resolveEffectChain(effects, `lane-${lane}`),
    };
    return layer;
  });
}

function render(
  count: number,
  effects: ChainEffect[],
  before?: (resources: WebGlResources) => void,
  sharedMedia = false,
  transforms: Array<LayerTransform | undefined> = [],
  clipTransforms: Array<LayerTransform | undefined> = [],
) {
  const recording = createRecordingGl();
  const resources = createWebGlResources(recording.gl);
  before?.(resources);
  recording.scramble();
  const mediaRefs = new Map<string, HTMLMediaElement>(
    Array.from({ length: count }, (_, lane) => [
      `media-${lane}`,
      new FakeVideo(1080, 1920) as unknown as HTMLMediaElement,
    ]),
  );
  drawComposition(
    resources,
    { width: WIDTH, height: HEIGHT },
    layers(count, effects, sharedMedia, transforms, clipTransforms),
    mediaRefs,
    resolveEffectChain(effects, "__group_main"),
    { time: 1, audio: SILENT_AUDIO_BANDS, groupClipProgress: 0 },
  );
  return {
    draws: recording.draws,
    resources,
    composites: recording.draws.filter(
      (draw) =>
        draw.program === (resources.program as unknown as Handle) &&
        draw.scissorTest,
    ),
    // Composite program draws onto the canvas, scissored or not.
    canvasDraws: recording.draws.filter(
      (draw) =>
        draw.program === (resources.program as unknown as Handle) &&
        draw.framebuffer === null,
    ),
  };
}

function assertCompositeState(
  draw: DrawCall,
  resources: WebGlResources,
  band: number,
  count: number,
  framebuffer: Handle | null,
) {
  const box = resolveBandScissor(band, count, WIDTH, HEIGHT);
  assert.equal(draw.program, resources.program as unknown as Handle);
  assert.equal(draw.framebuffer, framebuffer, `band ${band} framebuffer`);
  assert.equal(
    draw.arrayBuffer,
    resources.positionBuffer as unknown as Handle,
    `band ${band} array buffer`,
  );
  assert.deepEqual(
    draw.attribute,
    {
      enabled: true,
      buffer: resources.positionBuffer as unknown as Handle,
      size: 2,
    },
    `band ${band} position attribute`,
  );
  assert.ok(draw.blend, `band ${band} blends`);
  assert.deepEqual(draw.blendFunc, ["SRC_ALPHA", "ONE_MINUS_SRC_ALPHA"]);
  assert.deepEqual(draw.viewport, [0, 0, WIDTH, HEIGHT]);
  assert.deepEqual(
    draw.scissor,
    [box.x, box.y, box.width, box.height],
    `band ${band} scissor`,
  );
  assert.equal(draw.activeTexture, "TEXTURE0", `band ${band} texture unit`);
}

describe("drawComposition GL state", () => {
  const cases: Array<[string, (count: number) => ChainEffect[]]> = [
    ["no effects", () => []],
    ["an effect chain on the first layer drawn", () => [colorize("lane-0")]],
    [
      "effect chains on every layer",
      (count) =>
        Array.from({ length: count }, (_, lane) => colorize(`lane-${lane}`)),
    ],
    ["a Global effect chain", () => [colorize("__group_main")]],
  ];

  for (const count of [1, 2, 3]) {
    for (const [name, effects] of cases) {
      it(`restores the composite pipeline for ${count} layer(s) with ${name}`, () => {
        const chain = effects(count);
        const { composites, resources, draws } = render(count, chain);
        assert.equal(composites.length, count, "one composite draw per layer");
        const usesScene = chain.some(
          (effect) => effect.trackId === "__group_main",
        );
        const sceneFramebuffer = usesScene
          ? (draws[0].framebuffer as Handle)
          : null;
        if (usesScene) {
          assert.notEqual(sceneFramebuffer, null);
        }
        for (const [band, draw] of composites.entries()) {
          assertCompositeState(draw, resources, band, count, sceneFramebuffer);
        }
      });
    }
  }

  for (const sharedMedia of [false, true]) {
    it(`draws 2 active layers into 2 bands, first lane on top${sharedMedia ? ", from one shared media" : ""}`, () => {
      const { composites, resources } = render(2, [], undefined, sharedMedia);
      assert.equal(composites.length, 2, "both layers are drawn");
      for (const [band, draw] of composites.entries()) {
        assertCompositeState(draw, resources, band, 2, null);
        assert.equal(
          draw.texture,
          resources.textureMap.get(`media-${band}`) as unknown as Handle,
          `band ${band} shows lane ${band}`,
        );
      }
      assert.notEqual(composites[0].texture, composites[1].texture);
    });
  }

  it("runs a layer's effects at the size of its band", () => {
    const count = 3;
    const { draws, resources } = render(count, [colorize("lane-1")]);
    const effectDraws = draws.filter(
      (draw) =>
        draw.program !== (resources.program as unknown as Handle) ||
        !draw.scissorTest,
    );
    const box = resolveBandScissor(1, count, WIDTH, HEIGHT);
    assert.ok(effectDraws.length >= 2, "the layer is framed, then filtered");
    for (const draw of effectDraws) {
      assert.deepEqual(draw.viewport, [0, 0, box.width, box.height]);
      assert.notEqual(draw.framebuffer, null, "effects render offscreen");
    }
  });
});

describe("drawComposition Transform", () => {
  const moved: LayerTransform = {
    ...IDENTITY_TRANSFORM,
    positionX: 0.25,
    scaleX: 0.5,
    scaleY: 2,
    rotationDeg: 30,
  };

  it("draws an identity Transform exactly as no Transform", () => {
    for (const effects of [[], [colorize("lane-1")]]) {
      const plain = render(2, effects);
      const identity = render(2, effects, undefined, false, [
        IDENTITY_TRANSFORM,
        { ...IDENTITY_TRANSFORM, originX: 1, originY: -1 },
      ]);
      assert.equal(identity.draws.length, plain.draws.length);
      assert.deepEqual(
        identity.canvasDraws.map((draw) => [draw.scissor, draw.axes]),
        plain.canvasDraws.map((draw) => [draw.scissor, draw.axes]),
      );
    }
  });

  for (const effects of [[], [colorize("lane-1")]]) {
    it(`frames a transformed layer into its band, then draws it transformed and unclipped by the band${effects.length ? ", after its effects" : ""}`, () => {
      const { canvasDraws, resources, draws } = render(
        2,
        effects,
        undefined,
        false,
        [undefined, moved],
      );
      assert.equal(canvasDraws.length, 2);
      const [top, bottom] = canvasDraws;
      assertCompositeState(top, resources, 0, 2, null);

      const band = resolveBandScissor(1, 2, WIDTH, HEIGHT);
      const framing = draws.filter(
        (draw) =>
          draw.framebuffer !== null &&
          draw.viewport?.[2] === band.width &&
          draw.viewport?.[3] === band.height,
      );
      assert.ok(framing.length >= 1 + effects.length, "framed at band size");
      assert.notEqual(
        bottom.texture,
        resources.textureMap.get("media-1") as unknown as Handle,
        "the framed band is drawn, not the raw source",
      );
      assert.ok(!bottom.scissorTest, "only the canvas clips the layer");

      const { frame } = resolveLayerPlacement({
        index: 1,
        count: 2,
        canvasWidth: WIDTH,
        canvasHeight: HEIGHT,
        sourceWidth: 1080,
        sourceHeight: 1920,
        visual: { scale: 1, translateX: 0, translateY: 0, layoutAnchor: "top" },
      });
      const expected = transformedQuadAxes(frame, moved, {
        width: WIDTH,
        height: HEIGHT,
      });
      assert.deepEqual(bottom.axes, {
        uAxisX: expected.axisX,
        uAxisY: expected.axisY,
        uOffset: expected.offset,
      });
    });
  }
});

describe("drawComposition clip Transform", () => {
  const surface = { width: WIDTH, height: HEIGHT };
  const layerTransform: LayerTransform = {
    ...IDENTITY_TRANSFORM,
    positionX: 0.25,
    rotationDeg: 30,
  };
  const clipTransform: LayerTransform = {
    ...IDENTITY_TRANSFORM,
    scaleX: 0.5,
    positionY: 0.1,
  };
  const { frame } = resolveLayerPlacement({
    index: 1,
    count: 2,
    canvasWidth: WIDTH,
    canvasHeight: HEIGHT,
    sourceWidth: 1080,
    sourceHeight: 1920,
    visual: { scale: 1, translateX: 0, translateY: 0, layoutAnchor: "top" },
  });
  const axesOf = (
    layer: LayerTransform | undefined,
    clip: LayerTransform | undefined,
  ) => {
    const expected = matrixQuadAxes(
      frame,
      nestedTransformMatrix(
        frameBoxInCanvas(frame, surface),
        surface,
        layer,
        clip,
      ),
      surface,
    );
    return {
      uAxisX: expected.axisX,
      uAxisY: expected.axisY,
      uOffset: expected.offset,
    };
  };

  it("draws a clip Transform on its own like a layer Transform", () => {
    const { canvasDraws } = render(
      2,
      [],
      undefined,
      false,
      [],
      [undefined, clipTransform],
    );
    const bottom = canvasDraws[1];
    assert.ok(!bottom.scissorTest, "only the canvas clips the clip");
    const expected = transformedQuadAxes(frame, clipTransform, surface);
    assert.deepEqual(bottom.axes, {
      uAxisX: expected.axisX,
      uAxisY: expected.axisY,
      uOffset: expected.offset,
    });
  });

  it("draws the clip Transform inside the layer Transform", () => {
    for (const effects of [[], [colorize("lane-1")]]) {
      const { canvasDraws } = render(
        2,
        effects,
        undefined,
        false,
        [undefined, layerTransform],
        [undefined, clipTransform],
      );
      assert.deepEqual(
        canvasDraws[1].axes,
        axesOf(layerTransform, clipTransform),
      );
      assert.notDeepEqual(
        canvasDraws[1].axes,
        axesOf(layerTransform, undefined),
      );
    }
  });

  it("draws an identity clip Transform exactly as none", () => {
    const plain = render(2, []);
    const identity = render(
      2,
      [],
      undefined,
      false,
      [],
      [IDENTITY_TRANSFORM, IDENTITY_TRANSFORM],
    );
    assert.deepEqual(
      identity.canvasDraws.map((draw) => [draw.scissor, draw.axes]),
      plain.canvasDraws.map((draw) => [draw.scissor, draw.axes]),
    );
  });
});

describe("resolveBandScissor", () => {
  for (const height of [640, 1080, 1081, 1920, 1921]) {
    for (const count of [1, 2, 3]) {
      it(`tiles ${height} rows into ${count} band(s)`, () => {
        let nextTop = height;
        for (let band = 0; band < count; band++) {
          const box = resolveBandScissor(band, count, 100, height);
          assert.equal(box.y + box.height, nextTop);
          nextTop = box.y;
        }
        assert.equal(nextTop, 0);
      });
    }
  }
});

describe("drawComposition fill layers", () => {
  const RED_FILL: FillPaint = {
    kind: "solid",
    color: { r: 255, g: 0, b: 0, a: 1 },
    opacity: 1,
  };

  function fillLayer(fill: FillPaint, lane = 0): CompositeLayer {
    return {
      ...layers(1, [])[0],
      media: { id: `fill:clip-${lane}` },
      sourceKey: `fill:clip-${lane}`,
      laneRank: lane,
      fill,
    };
  }

  function drawFrame(
    recording: ReturnType<typeof createRecordingGl>,
    resources: WebGlResources,
    clips: CompositeLayer[],
    mediaRefs = new Map<string, HTMLMediaElement>(),
    order?: CompositionOrder,
  ) {
    drawComposition(
      resources,
      { width: WIDTH, height: HEIGHT },
      clips,
      mediaRefs,
      [],
      { time: 0, audio: SILENT_AUDIO_BANDS, groupClipProgress: 0 },
      order,
    );
    return recording.draws.filter(
      (draw) =>
        draw.program === (resources.program as unknown as Handle) &&
        draw.scissorTest,
    );
  }

  it("draws a fill into its band without a media element", () => {
    const recording = createRecordingGl();
    const resources = createWebGlResources(recording.gl);
    const composites = drawFrame(recording, resources, [fillLayer(RED_FILL)]);
    assert.equal(composites.length, 1);
    assertCompositeState(composites[0], resources, 0, 1, null);
    assert.equal(
      composites[0].texture,
      resources.textureMap.get("fill:clip-0") as unknown as Handle,
    );

    const [upload] = recording.uploads;
    const pixels = upload.at(-1) as Uint8Array;
    const [width, height] = [upload[3], upload[4]] as [number, number];
    assert.equal(pixels.length, width * height * 4);
    assert.deepEqual(Array.from(pixels.slice(0, 4)), [255, 0, 0, 255]);
    // Drawn at the band's aspect, no larger than 512 pixels on a side.
    assert.equal(Math.max(width, height), 512);
    assert.ok(Math.abs(width / height - WIDTH / HEIGHT) < 0.01);
  });

  it("stacks a fill with media layers", () => {
    const recording = createRecordingGl();
    const resources = createWebGlResources(recording.gl);
    const video = layers(1, [])[0];
    const composites = drawFrame(
      recording,
      resources,
      [video, fillLayer(RED_FILL, 1)],
      new Map([
        ["media-0", new FakeVideo(1080, 1920) as unknown as HTMLMediaElement],
      ]),
    );
    assert.equal(composites.length, 2);
    assertCompositeState(composites[1], resources, 1, 2, null);
    assert.equal(
      composites[1].texture,
      resources.textureMap.get("fill:clip-1") as unknown as Handle,
    );
  });

  it("draws a fill at its slot's size in a Horizontal arrangement", () => {
    const recording = createRecordingGl();
    const resources = createWebGlResources(recording.gl);
    drawFrame(
      recording,
      resources,
      [fillLayer(RED_FILL, 0), fillLayer(RED_FILL, 1)],
      undefined,
      { arrangement: "horizontal", gridSize: 2, spacing: 0 },
    );
    // Two side-by-side columns of 180×640 pixels.
    for (const upload of recording.uploads) {
      const [width, height] = [upload[3], upload[4]] as [number, number];
      assert.ok(Math.abs(width / height - WIDTH / 2 / HEIGHT) < 0.01);
    }
    assert.equal(recording.uploads.length, 2);
  });

  it("draws every Grid cell at the widest spacing on a small output", () => {
    const recording = createRecordingGl();
    const resources = createWebGlResources(recording.gl);
    const order: CompositionOrder = {
      arrangement: "grid",
      gridSize: 6,
      spacing: 50,
    };
    const count = 36;
    const composites = drawFrame(
      recording,
      resources,
      Array.from({ length: count }, (_, lane) => fillLayer(RED_FILL, lane)),
      undefined,
      order,
    );
    assert.equal(composites.length, count);
    composites.forEach((draw, index) => {
      const box = resolveSlotScissor(index, count, order, WIDTH, HEIGHT);
      assert.deepEqual(
        draw.scissor,
        [box.x, box.y, box.width, box.height],
        `cell ${index} scissor`,
      );
      assert.ok(box.width > 1 && box.height > 1, `cell ${index} size`);
    });
    // 50 at 1080p is 50 / 3 px here: the first column is (360 - 5 × 50 / 3)
    // / 6 ≈ 46.1 px wide, so the second starts at ≈ 62.8 px.
    assert.equal(composites[1].scissor?.[0], 63);
    for (const upload of recording.uploads) {
      const [width, height] = [upload[3], upload[4]] as [number, number];
      assert.ok(width >= 1 && height >= 1);
    }
  });

  it("redraws a fill's texture only when its paint changes", () => {
    const recording = createRecordingGl();
    const resources = createWebGlResources(recording.gl);
    drawFrame(recording, resources, [fillLayer(RED_FILL)]);
    drawFrame(recording, resources, [fillLayer(RED_FILL)]);
    assert.equal(recording.uploads.length, 1);

    drawFrame(recording, resources, [
      fillLayer({ ...RED_FILL, color: { r: 0, g: 0, b: 255, a: 1 } }),
    ]);
    assert.equal(recording.uploads.length, 2);
    const pixels = recording.uploads[1].at(-1) as Uint8Array;
    assert.deepEqual(Array.from(pixels.slice(0, 4)), [0, 0, 255, 255]);
  });
});

describe("drawComposition text layers", () => {
  type TextCall = { text: string; x: number; y: number; font: string };

  // An OffscreenCanvas stand-in whose 2D context measures every character
  // as half an em and records the text it draws.
  class FakeTextCanvas {
    fills: TextCall[] = [];
    strokes: TextCall[] = [];
    context: Record<string, unknown>;
    width: number;
    height: number;

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      const size = () =>
        Number.parseFloat(
          /([\d.]+)px/.exec(String(this.context.font))?.[1] ?? "10",
        );
      const record =
        (calls: TextCall[]) => (text: string, x: number, y: number) =>
          calls.push({ text, x, y, font: String(this.context.font) });
      this.context = {
        font: "10px sans-serif",
        letterSpacing: "0px",
        measureText: (text: string) => ({
          width: Array.from(text).length * size() * 0.5,
          fontBoundingBoxAscent: size() * 0.8,
          fontBoundingBoxDescent: size() * 0.2,
        }),
        fillText: record(this.fills),
        strokeText: record(this.strokes),
        createLinearGradient: () => ({ addColorStop: () => undefined }),
        createRadialGradient: () => ({ addColorStop: () => undefined }),
        clearRect: () => undefined,
        fillRect: () => undefined,
        strokeRect: () => undefined,
      };
    }

    getContext() {
      return this.context;
    }
  }

  beforeEach(() => {
    savedGlobals.OffscreenCanvas = globals.OffscreenCanvas;
    globals.OffscreenCanvas = FakeTextCanvas;
  });

  function textLayer(text: TextStyle, lane = 0): CompositeLayer {
    return {
      ...layers(1, [])[0],
      media: { id: `text:clip-${lane}` },
      sourceKey: `text:clip-${lane}`,
      laneRank: lane,
      text,
    };
  }

  function drawFrame(
    resources: WebGlResources,
    clips: CompositeLayer[],
    order?: CompositionOrder,
  ) {
    drawComposition(
      resources,
      { width: WIDTH, height: HEIGHT },
      clips,
      new Map(),
      [],
      { time: 0, audio: SILENT_AUDIO_BANDS, groupClipProgress: 0 },
      order,
    );
  }

  const HELLO = { ...readTextStyle(undefined), text: "Hello" };

  it("draws text at its slot's full size, scaled from 1080p", () => {
    const recording = createRecordingGl();
    const resources = createWebGlResources(recording.gl);
    drawFrame(resources, [textLayer(HELLO)]);

    assert.equal(recording.uploads.length, 1);
    const canvas = recording.uploads[0].at(-1) as FakeTextCanvas;
    assert.ok(canvas instanceof FakeTextCanvas);
    // Not capped like fills: the whole 360×640 slot.
    assert.deepEqual([canvas.width, canvas.height], [WIDTH, HEIGHT]);
    // 96px at 1080p on a 360px short side.
    assert.equal(canvas.fills.length, 1);
    assert.equal(canvas.fills[0].text, "Hello");
    assert.match(canvas.fills[0].font, /^400 32px "Inter Variable"/);
    // Centred: five 16px characters in the 360px slot.
    assert.equal(canvas.fills[0].x, (WIDTH - 80) / 2);
    assert.equal(canvas.strokes.length, 0);
  });

  it("strokes before filling when the text has an outline", () => {
    const recording = createRecordingGl();
    const resources = createWebGlResources(recording.gl);
    drawFrame(resources, [
      textLayer({
        ...HELLO,
        stroke: { color: { r: 0, g: 0, b: 0, a: 1 }, width: 4 },
      }),
    ]);
    const canvas = recording.uploads[0].at(-1) as FakeTextCanvas;
    assert.equal(canvas.strokes.length, 1);
    assert.equal(canvas.fills.length, 1);
  });

  it("redraws the texture only when the text or its box changes", () => {
    const recording = createRecordingGl();
    const resources = createWebGlResources(recording.gl);
    drawFrame(resources, [textLayer(HELLO)]);
    drawFrame(resources, [textLayer({ ...HELLO })]);
    assert.equal(recording.uploads.length, 1);

    drawFrame(resources, [textLayer({ ...HELLO, text: "Bye" })]);
    assert.equal(recording.uploads.length, 2);

    // Side by side, the first layer's box halves and a second one appears.
    drawFrame(
      resources,
      [textLayer({ ...HELLO, text: "Bye" }), textLayer(HELLO, 1)],
      { arrangement: "horizontal", gridSize: 2, spacing: 0 },
    );
    assert.equal(recording.uploads.length, 4);
    const canvas = recording.uploads[2].at(-1) as FakeTextCanvas;
    assert.deepEqual([canvas.width, canvas.height], [WIDTH / 2, HEIGHT]);
  });

  function transformedText(text: TextStyle, transform: LayerTransform) {
    const layer = textLayer(text);
    return { ...layer, visual: { ...layer.visual, transform } };
  }

  // Four-letter words, 64px each at 32px with a 16px space.
  const WORDS = { ...HELLO, text: "aaaa bbbb cccc dddd eeee ffff" };

  it("widens a text layer's box with ScaleX, re-wrapping the text at the same size", () => {
    const plain = createRecordingGl();
    drawFrame(createWebGlResources(plain.gl), [textLayer(WORDS)]);
    const plainCanvas = plain.uploads[0].at(-1) as FakeTextCanvas;
    assert.deepEqual(
      plainCanvas.fills.map((call) => call.text),
      ["aaaa bbbb cccc dddd", "eeee ffff"],
    );

    const wide = createRecordingGl();
    drawFrame(createWebGlResources(wide.gl), [
      transformedText(WORDS, { ...IDENTITY_TRANSFORM, scaleX: 2 }),
    ]);
    const wideCanvas = wide.uploads[0].at(-1) as FakeTextCanvas;
    // Drawn at the doubled box's own size, so the glyphs aren't stretched.
    assert.deepEqual(
      [wideCanvas.width, wideCanvas.height],
      [WIDTH * 2, HEIGHT],
    );
    assert.deepEqual(
      wideCanvas.fills.map((call) => call.text),
      ["aaaa bbbb cccc dddd eeee ffff"],
    );
    assert.equal(wideCanvas.fills[0].font, plainCanvas.fills[0].font);
  });

  it("widens a text clip's box with its own ScaleX inside its layer's", () => {
    const wide = createRecordingGl();
    const layer = transformedText(WORDS, { ...IDENTITY_TRANSFORM, scaleX: 2 });
    drawFrame(createWebGlResources(wide.gl), [
      {
        ...layer,
        visual: {
          ...layer.visual,
          clipTransform: { ...IDENTITY_TRANSFORM, scaleX: 0.75 },
        },
      },
    ]);
    const wideCanvas = wide.uploads[0].at(-1) as FakeTextCanvas;
    // Both widths resize the box: 2 × 0.75 of the band, unstretched.
    assert.deepEqual(
      [wideCanvas.width, wideCanvas.height],
      [WIDTH * 1.5, HEIGHT],
    );
  });

  it("shrinks text to fit a shorter box with ScaleY and Resize to fit", () => {
    const lines = { ...HELLO, text: Array(12).fill("a").join("\n") };
    const fontSize = (text: TextStyle, transform: LayerTransform) => {
      const recording = createRecordingGl();
      drawFrame(createWebGlResources(recording.gl), [
        transformedText(text, transform),
      ]);
      const canvas = recording.uploads[0].at(-1) as FakeTextCanvas;
      return Number.parseFloat(
        /([\d.]+)px/.exec(canvas.fills[0].font)?.[1] ?? "",
      );
    };
    const short = { ...IDENTITY_TRANSFORM, scaleY: 0.5 };

    // Twelve 38.4px lines fit in 640px but not in 320px.
    assert.equal(
      fontSize({ ...lines, resizeToFit: true }, IDENTITY_TRANSFORM),
      32,
    );
    assert.equal(fontSize(lines, short), 32);
    const fitted = fontSize({ ...lines, resizeToFit: true }, short);
    assert.ok(fitted < 32, `${fitted}px shrinks to fit`);
    assert.ok(12 * 1.2 * fitted <= HEIGHT / 2 + 0.5, `${fitted}px fits`);
  });

  it("draws a resized text box where its Transform puts the layer, unstretched", () => {
    const transform: LayerTransform = {
      ...IDENTITY_TRANSFORM,
      positionX: 0.25,
      scaleX: 0.5,
      scaleY: 2,
      originX: -1,
      originY: 1,
      rotationDeg: 30,
    };
    const recording = createRecordingGl();
    const resources = createWebGlResources(recording.gl);
    drawFrame(resources, [transformedText(HELLO, transform)]);

    // Framed at the resized box's size.
    const framing = recording.draws.filter(
      (draw) =>
        draw.framebuffer !== null &&
        draw.viewport?.[2] === WIDTH / 2 &&
        draw.viewport?.[3] === HEIGHT * 2,
    );
    assert.equal(framing.length, 1);

    const canvasDraws = recording.draws.filter(
      (draw) =>
        draw.program === (resources.program as unknown as Handle) &&
        draw.framebuffer === null,
    );
    assert.equal(canvasDraws.length, 1);
    assert.ok(!canvasDraws[0].scissorTest);
    // The quad covers the same box a stretched layer would.
    const { frame } = resolveLayerPlacement({
      index: 0,
      count: 1,
      canvasWidth: WIDTH,
      canvasHeight: HEIGHT,
      sourceWidth: WIDTH,
      sourceHeight: HEIGHT,
      visual: { scale: 1, translateX: 0, translateY: 0, layoutAnchor: "top" },
    });
    const expected = transformedQuadAxes(frame, transform, {
      width: WIDTH,
      height: HEIGHT,
    });
    const { uAxisX, uAxisY, uOffset } = canvasDraws[0].axes;
    for (const [actual, wanted] of [
      [uAxisX, expected.axisX],
      [uAxisY, expected.axisY],
      [uOffset, expected.offset],
    ]) {
      assert.ok(
        Math.abs(actual[0] - wanted[0]) < 1e-9,
        `${actual} ≈ ${wanted}`,
      );
      assert.ok(
        Math.abs(actual[1] - wanted[1]) < 1e-9,
        `${actual} ≈ ${wanted}`,
      );
    }
  });

  it("caps a text box's texture at the largest texture size", () => {
    const recording = createRecordingGl();
    drawFrame(createWebGlResources(recording.gl), [
      transformedText(HELLO, { ...IDENTITY_TRANSFORM, scaleY: 8 }),
    ]);
    const canvas = recording.uploads[0].at(-1) as FakeTextCanvas;
    // 640 × 8 = 5120 rows, over the context's 4096.
    assert.deepEqual([canvas.width, canvas.height], [288, 4096]);
    assert.match(canvas.fills[0].font, /^400 25.6px /);
  });

  it("stacks text over a fill in its own band", () => {
    const recording = createRecordingGl();
    const resources = createWebGlResources(recording.gl);
    const fill: CompositeLayer = {
      ...layers(1, [])[0],
      media: { id: "fill:clip-0" },
      sourceKey: "fill:clip-0",
      fill: {
        kind: "solid",
        color: { r: 255, g: 0, b: 0, a: 1 },
        opacity: 1,
      },
    };
    drawFrame(resources, [fill, textLayer(HELLO, 1)]);
    const composites = recording.draws.filter(
      (draw) =>
        draw.program === (resources.program as unknown as Handle) &&
        draw.scissorTest,
    );
    assert.equal(composites.length, 2);
    assert.equal(
      composites[1].texture,
      resources.textureMap.get("text:clip-1") as unknown as Handle,
    );
  });
});

describe("drawComposition FX clips", () => {
  const surface = { width: WIDTH, height: HEIGHT };

  // Media layers on `ranks`, each drawing its own video.
  function mediaLayers(ranks: number[]) {
    return layers(ranks.length, []).map((layer, index) => ({
      ...layer,
      laneRank: ranks[index],
      sourceKey: `media-${ranks[index]}`,
    }));
  }

  function fxLayer(
    laneRank: number,
    effects: ChainEffect[],
    clipTransform?: LayerTransform,
  ): CompositeLayer {
    const [layer] = layers(1, [], false, [], [clipTransform]);
    return {
      ...layer,
      media: { id: `fx:${laneRank}` },
      sourceKey: `fx:${laneRank}`,
      laneRank,
      effectChain: resolveEffectChain(effects, "clip:fx"),
      fx: true,
    };
  }

  function draw(
    entries: CompositeLayer[],
    order: CompositionOrder = Z_ORDER_COMPOSITION,
  ) {
    const recording = createRecordingGl();
    const resources = createWebGlResources(recording.gl);
    const mediaRefs = new Map<string, HTMLMediaElement>(
      entries
        .filter((entry) => !entry.fx)
        .map((entry) => [
          entry.sourceKey,
          new FakeVideo(1080, 1920) as unknown as HTMLMediaElement,
        ]),
    );
    drawComposition(
      resources,
      surface,
      entries,
      mediaRefs,
      [],
      {
        time: 1,
        audio: SOURCE_SILENCE,
        groupClipProgress: 0,
      },
      order,
    );
    const program = (draw: DrawCall) =>
      draw.program === (resources.program as unknown as Handle)
        ? "composite"
        : draw.program === (resources.fxMask.program as unknown as Handle)
          ? "fx-mask"
          : "effect";
    return { draws: recording.draws, resources, program };
  }

  const SOURCE_SILENCE = SILENT_AUDIO_BANDS;

  it("draws exactly as without it when it has no effects", () => {
    for (const order of [Z_ORDER_COMPOSITION, DEFAULT_COMPOSITION_ORDER]) {
      const without = draw(mediaLayers([0, 2]), order);
      const withEmpty = draw([...mediaLayers([0, 2]), fxLayer(1, [])], order);
      assert.deepEqual(withEmpty.draws, without.draws);
    }
  });

  it("adjusts only the layers beneath it, over the whole canvas", () => {
    const { draws, resources, program } = draw([
      ...mediaLayers([0, 2]),
      fxLayer(1, [colorize("clip:fx")]),
    ]);
    const scene = resources.effectChain.getSceneTarget(WIDTH, HEIGHT);
    const sceneFramebuffer = scene.framebuffer as unknown as Handle;
    assert.deepEqual(
      draws.map((call) => [
        program(call),
        call.framebuffer === sceneFramebuffer,
      ]),
      [
        // Layer 3, beneath the FX clip, into the offscreen composite.
        ["composite", true],
        // Colorize on the composite so far, then back over its box.
        ["effect", false],
        ["fx-mask", true],
        // Layer 1, above it, drawn after and so left alone.
        ["composite", true],
        // The composite shown on the canvas.
        ["composite", false],
      ],
    );
    assert.equal(draws[1].texture, scene.texture as unknown as Handle);
    assert.notEqual(draws[2].texture, scene.texture as unknown as Handle);
    assert.equal(draws[2].blend, false);
    assert.equal(draws[2].scissorTest, false);
    assert.deepEqual(draws[2].axes, {
      uAxisX: [1, 0],
      uAxisY: [0, 1],
      uOffset: [0, 0],
    });
    assert.equal(draws[4].framebuffer, null);
    assert.equal(draws[4].texture, scene.texture as unknown as Handle);
  });

  it("limits the adjustment to its Transform box", () => {
    const clipTransform: LayerTransform = {
      ...IDENTITY_TRANSFORM,
      scaleX: 0.5,
      scaleY: 0.5,
      positionX: 0.25,
    };
    const { draws, program } = draw([
      ...mediaLayers([1]),
      fxLayer(0, [colorize("clip:fx")], clipTransform),
    ]);
    const mask = draws.find((call) => program(call) === "fx-mask");
    const frame = resolveCanvasBounds(WIDTH, HEIGHT);
    const expected = matrixQuadAxes(
      frame,
      nestedTransformMatrix(
        frameBoxInCanvas(frame, surface),
        surface,
        undefined,
        clipTransform,
      ),
      surface,
    );
    assert.deepEqual(mask?.axes, {
      uAxisX: expected.axisX,
      uAxisY: expected.axisY,
      uOffset: expected.offset,
    });
    // Half the canvas across and down, moved a quarter canvas right.
    assert.ok(Math.abs((mask?.axes.uAxisX[0] ?? 0) - 0.5) < 1e-9);
    assert.ok(Math.abs((mask?.axes.uAxisY[1] ?? 0) - 0.5) < 1e-9);
    assert.ok(Math.abs((mask?.axes.uOffset[0] ?? 0) - 0.5) < 1e-9);
  });

  it("takes no Order slot", () => {
    const { draws, program } = draw(
      [...mediaLayers([1, 2]), fxLayer(0, [colorize("clip:fx")])],
      DEFAULT_COMPOSITION_ORDER,
    );
    const composites = draws.filter(
      (call) => program(call) === "composite" && call.scissorTest,
    );
    // Layer 3 in the lower band, Layer 2 in the upper one, then the FX clip
    // on Layer 1 over both.
    assert.deepEqual(
      composites.map((call) => call.scissor),
      [1, 0].map((band) => {
        const slot = resolveSlotScissor(
          band,
          2,
          DEFAULT_COMPOSITION_ORDER,
          WIDTH,
          HEIGHT,
        );
        return [slot.x, slot.y, slot.width, slot.height];
      }),
    );
    assert.deepEqual(draws.map(program).slice(-3), [
      "effect",
      "fx-mask",
      "composite",
    ]);
  });

  it("is adjusted by the Global chain after it", () => {
    const recording = createRecordingGl();
    const resources = createWebGlResources(recording.gl);
    const entries = [...mediaLayers([1]), fxLayer(0, [colorize("clip:fx")])];
    drawComposition(
      resources,
      surface,
      entries,
      new Map([
        ["media-1", new FakeVideo(1080, 1920) as unknown as HTMLMediaElement],
      ]),
      resolveEffectChain([colorize("__group_main")], "__group_main"),
      { time: 1, audio: SILENT_AUDIO_BANDS, groupClipProgress: 0 },
      Z_ORDER_COMPOSITION,
    );
    const last = recording.draws[recording.draws.length - 1];
    const mask = recording.draws.findIndex(
      (call) =>
        call.program === (resources.fxMask.program as unknown as Handle),
    );
    assert.ok(mask > 0 && mask < recording.draws.length - 1);
    // The Global chain's last pass draws straight to the canvas.
    assert.equal(last.framebuffer, null);
    assert.notEqual(last.program, resources.program as unknown as Handle);
  });
});
