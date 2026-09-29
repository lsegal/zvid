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
  resolveLayerPlacement,
  resolveSlotScissor,
} from "./composition-layout.ts";
import type { CompositionOrder } from "./composition-order.ts";
import {
  IDENTITY_TRANSFORM,
  type LayerTransform,
  transformedQuadAxes,
} from "./composition-transform.ts";
import type { FillPaint } from "./fill-paint.ts";
import { SILENT_AUDIO_BANDS } from "./fx-shaders/audio-bands.ts";
import { POSITION_ATTRIBUTE_LOCATION } from "./fx-shaders/gl.ts";
import { type ChainEffect, resolveEffectChain } from "./fx-shaders/registry.ts";

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
    layers(count, effects, sharedMedia, transforms),
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
