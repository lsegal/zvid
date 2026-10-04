// Source texture lifetime and video uploads, driven through drawComposition
// with a WebGL stand-in that counts textures and uploads.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  type CompositeLayer,
  createWebGlResources,
  drawComposition,
  type WebGlResources,
} from "./composition-draw.ts";
import { TEXTURE_GRACE_DRAWS } from "./composition-textures.ts";
import { SILENT_AUDIO_BANDS } from "./fx-shaders/audio-bands.ts";
import { POSITION_ATTRIBUTE_LOCATION } from "./fx-shaders/gl.ts";
import { readTextStyle } from "./text-style.ts";

const WIDTH = 360;
const HEIGHT = 640;

type Upload = { source: unknown; flipY: unknown };

// A WebGLRenderingContext stand-in that tracks live textures and every
// upload. Constants resolve to their own names, and other calls are
// accepted and ignored.
function createCountingGl() {
  let nextId = 1;
  const live = new Set<number>();
  const pixelStore = new Map<string, unknown>();
  // texImage2D calls that size storage from explicit dimensions, with or
  // without pixels, and those that take their size from the source.
  const allocations: Array<{ width: unknown; height: unknown; data: unknown }> =
    [];
  const sourcedUploads: Upload[] = [];
  const subUploads: Upload[] = [];
  const parameterReads: unknown[] = [];
  const methods: Record<string, (...args: never[]) => unknown> = {
    createBuffer: () => ({ id: nextId++ }),
    createFramebuffer: () => ({ id: nextId++ }),
    createShader: () => ({ id: nextId++ }),
    createProgram: () => ({ id: nextId++ }),
    createTexture: () => {
      const id = nextId++;
      live.add(id);
      return { id };
    },
    deleteTexture: (texture: { id: number } | null) => {
      if (texture) live.delete(texture.id);
    },
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getAttribLocation: () => POSITION_ATTRIBUTE_LOCATION,
    getUniformLocation: (_program: unknown, name: string) => ({ name }),
    checkFramebufferStatus: () => "FRAMEBUFFER_COMPLETE",
    getParameter: (name: unknown) => {
      parameterReads.push(name);
      return 4096;
    },
    pixelStorei: (name: string, value: unknown) => {
      pixelStore.set(name, value);
    },
    texImage2D: (...args: unknown[]) => {
      if (args.length === 9) {
        allocations.push({ width: args[3], height: args[4], data: args[8] });
      } else {
        sourcedUploads.push({
          source: args[5],
          flipY: pixelStore.get("UNPACK_FLIP_Y_WEBGL"),
        });
      }
    },
    texSubImage2D: (...args: unknown[]) => {
      subUploads.push({
        source: args.at(-1),
        flipY: pixelStore.get("UNPACK_FLIP_Y_WEBGL"),
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
  return { gl, live, allocations, sourcedUploads, subUploads, parameterReads };
}

type FrameCallback = (
  now: number,
  metadata: { presentedFrames: number; mediaTime: number },
) => void;

class FakeVideo {
  readyState = 4;
  paused = true;
  seeking = false;
  currentTime = 0;
  currentSrc = "blob:video";
  src = "blob:video";
  videoWidth: number;
  videoHeight: number;
  presentedFrames = 0;
  private callbacks: FrameCallback[] = [];

  constructor(width = 1080, height = 1920) {
    this.videoWidth = width;
    this.videoHeight = height;
  }

  requestVideoFrameCallback(callback: FrameCallback) {
    this.callbacks.push(callback);
    return this.callbacks.length;
  }

  // Presents the next decoded frame, as the browser does before a paint.
  presentFrame(mediaTime: number) {
    this.presentedFrames += 1;
    const callbacks = this.callbacks;
    this.callbacks = [];
    for (const callback of callbacks) {
      callback(performance.now(), {
        presentedFrames: this.presentedFrames,
        mediaTime,
      });
    }
  }
}

class FakeTextCanvas {
  width: number;
  height: number;
  context = {
    font: "10px sans-serif",
    letterSpacing: "0px",
    measureText: (text: string) => ({
      width: text.length * 5,
      fontBoundingBoxAscent: 8,
      fontBoundingBoxDescent: 2,
    }),
    fillText: () => undefined,
    strokeText: () => undefined,
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    clearRect: () => undefined,
    fillRect: () => undefined,
    strokeRect: () => undefined,
  };

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext() {
    return this.context;
  }
}

const globals = globalThis as Record<string, unknown>;
let savedGlobals: Record<string, unknown> = {};

beforeEach(() => {
  savedGlobals = {
    HTMLVideoElement: globals.HTMLVideoElement,
    HTMLMediaElement: globals.HTMLMediaElement,
    OffscreenCanvas: globals.OffscreenCanvas,
  };
  globals.HTMLVideoElement = FakeVideo;
  globals.HTMLMediaElement = { HAVE_CURRENT_DATA: 2 };
  globals.OffscreenCanvas = FakeTextCanvas;
});

afterEach(() => {
  Object.assign(globals, savedGlobals);
});

function layer(sourceKey: string, lane: number): CompositeLayer {
  return {
    clip: { startQ: 0 },
    media: { id: sourceKey, width: 1080, height: 1920 },
    sourceKey,
    isInBounds: true,
    laneRank: lane,
    clipProgress: 0,
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
    },
    effectChain: [],
  };
}

function textLayer(lane: number): CompositeLayer {
  return {
    ...layer(`text:clip-${lane}`, lane),
    text: { ...readTextStyle(undefined), text: `Clip ${lane}` },
  };
}

function draw(
  resources: WebGlResources,
  clips: CompositeLayer[],
  mediaRefs = new Map<string, HTMLMediaElement>(),
) {
  drawComposition(
    resources,
    { width: WIDTH, height: HEIGHT },
    clips,
    mediaRefs,
    [],
    { time: 0, audio: SILENT_AUDIO_BANDS, groupClipProgress: 0 },
  );
}

function setup() {
  const counting = createCountingGl();
  const resources = createWebGlResources(counting.gl);
  return { ...counting, resources };
}

describe("source texture lifetime", () => {
  it("frees the textures of deleted text clips after the grace period", () => {
    const { live, resources } = setup();
    const baseline = live.size;
    const texts = Array.from({ length: 50 }, (_, lane) => textLayer(lane));
    // Insert the clips one at a time, then delete them all.
    for (let count = 1; count <= texts.length; count++) {
      draw(resources, texts.slice(0, count));
    }
    assert.equal(live.size, baseline + 50);

    for (let index = 0; index < TEXTURE_GRACE_DRAWS; index++) {
      draw(resources, []);
    }
    assert.equal(live.size, baseline + 50, "kept through the grace period");
    draw(resources, []);
    assert.equal(live.size, baseline);
    assert.equal(resources.textureMap.size, 0);
    assert.equal(resources.rasters.size, 0);
    assert.equal(resources.textureLastDrawn.size, 0);
  });

  it("keeps a briefly hidden clip's texture without redrawing it", () => {
    const { live, allocations, resources } = setup();
    draw(resources, [textLayer(0)]);
    const texturesShown = live.size;
    const drawn = allocations.length;
    for (let index = 0; index < 10; index++) {
      draw(resources, []);
    }
    draw(resources, [textLayer(0)]);
    assert.equal(live.size, texturesShown);
    assert.equal(allocations.length, drawn);
  });

  it("frees a video's texture once its media element is removed", () => {
    const { live, resources } = setup();
    const baseline = live.size;
    const mediaRefs = new Map([
      ["media-0", new FakeVideo() as unknown as HTMLMediaElement],
    ]);
    draw(resources, [layer("media-0", 0)], mediaRefs);
    assert.equal(live.size, baseline + 1);

    draw(resources, [], new Map());
    assert.equal(live.size, baseline);
    assert.equal(resources.videoUploads.size, 0);
    assert.equal(resources.readyTextureIds.size, 0);
  });
});

describe("texture size limit", () => {
  it("reads the largest texture size once per context", () => {
    const { resources, parameterReads } = setup();
    const reads = () =>
      parameterReads.filter((name) => name === "MAX_TEXTURE_SIZE").length;
    draw(resources, [textLayer(0)]);
    const afterFirst = reads();
    for (let frame = 0; frame < 10; frame++) {
      draw(resources, [textLayer(0), textLayer(1)]);
    }
    assert.equal(reads(), afterFirst);
  });
});

describe("video uploads", () => {
  function setupVideo(video = new FakeVideo()) {
    const counting = setup();
    const mediaRefs = new Map([
      ["media-0", video as unknown as HTMLMediaElement],
    ]);
    return {
      ...counting,
      video,
      drawVideo: () =>
        draw(counting.resources, [layer("media-0", 0)], mediaRefs),
    };
  }

  it("uploads a paused video's frame once however often it is redrawn", () => {
    const { allocations, subUploads, sourcedUploads, drawVideo } = setupVideo();
    for (let index = 0; index < 100; index++) {
      drawVideo();
    }
    assert.equal(allocations.length, 1);
    assert.equal(subUploads.length, 1);
    assert.equal(sourcedUploads.length, 0);
  });

  it("allocates storage at the video's size and writes frames into it", () => {
    const { allocations, subUploads, video, drawVideo } = setupVideo();
    drawVideo();
    assert.deepEqual(allocations, [{ width: 1080, height: 1920, data: null }]);
    // Preview and export both upload the element itself, top row first.
    assert.deepEqual(subUploads, [{ source: video, flipY: 0 }]);
  });

  it("uploads about once per frame of 30 fps video drawn at 60 Hz", () => {
    const { allocations, subUploads, video, drawVideo } = setupVideo();
    video.paused = false;
    for (let tick = 0; tick < 120; tick++) {
      // A new frame every other tick; the clock moves on every tick.
      if (tick % 2 === 0) {
        video.presentFrame(tick / 60);
      }
      video.currentTime = tick / 60;
      drawVideo();
    }
    assert.equal(allocations.length, 1);
    // The first draw finds no frame callback yet, then one per frame.
    assert.ok(
      subUploads.length >= 60 && subUploads.length <= 61,
      `${subUploads.length} uploads`,
    );
  });

  it("uploads every draw of a playing video without frame callbacks", () => {
    const video = new FakeVideo();
    (
      video as { requestVideoFrameCallback?: unknown }
    ).requestVideoFrameCallback = undefined;
    const { subUploads, drawVideo } = setupVideo(video);
    video.paused = false;
    for (let tick = 0; tick < 10; tick++) {
      video.currentTime = tick / 60;
      drawVideo();
    }
    assert.equal(subUploads.length, 10);
  });

  it("reallocates when the video's size changes", () => {
    const { allocations, subUploads, video, drawVideo } = setupVideo();
    drawVideo();
    drawVideo();
    video.videoWidth = 1920;
    video.videoHeight = 1080;
    drawVideo();
    drawVideo();
    assert.deepEqual(
      allocations.map(({ width, height }) => [width, height]),
      [
        [1080, 1920],
        [1920, 1080],
      ],
    );
    assert.equal(subUploads.length, 2);
  });

  it("uploads one frame per exported frame", () => {
    const { allocations, subUploads, video, drawVideo } = setupVideo();
    for (let frame = 0; frame < 30; frame++) {
      // Export seeks the paused element to each frame before drawing.
      video.currentTime = frame / 30;
      drawVideo();
    }
    assert.equal(allocations.length, 1);
    assert.equal(subUploads.length, 30);
  });

  it("uploads again after a draw made mid-seek", () => {
    const { subUploads, video, drawVideo } = setupVideo();
    drawVideo();
    video.currentTime = 2;
    video.seeking = true;
    drawVideo();
    video.seeking = false;
    drawVideo();
    drawVideo();
    assert.equal(subUploads.length, 3);
  });

  it("uploads a frame presented late after a seek", () => {
    const { subUploads, video, drawVideo } = setupVideo();
    drawVideo();
    video.currentTime = 2;
    drawVideo();
    video.presentFrame(2);
    drawVideo();
    drawVideo();
    assert.equal(subUploads.length, 3);
  });

  it("keeps the last frame while the element has none to show", () => {
    const { subUploads, video, drawVideo, resources } = setupVideo();
    drawVideo();
    video.readyState = 1;
    video.currentTime = 3;
    drawVideo();
    assert.equal(subUploads.length, 1);
    assert.ok(resources.readyTextureIds.has("media-0"));
  });
});
