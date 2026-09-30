import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createFrameThumbnailer,
  type FrameSource,
  type FrameThumbnailerOptions,
} from "./frame-thumbnails.ts";

const SIZE = { width: 96, height: 54 };

type FakeCanvas = HTMLCanvasElement & { label: string };

function fakeCanvas(label: string) {
  return { label } as FakeCanvas;
}

function setup(
  overrides: Partial<FrameThumbnailerOptions> & {
    decodable?: (url: string) => boolean;
    gate?: Promise<void>;
  } = {},
) {
  const log: string[] = [];
  let active = 0;
  let maxActive = 0;
  const open = async (url: string): Promise<FrameSource | null> => {
    log.push(`open ${url}`);
    if (overrides.decodable && !overrides.decodable(url)) {
      return null;
    }
    return {
      async frameAt(timeSeconds) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (url === "gated.mp4") {
          await overrides.gate;
        }
        active -= 1;
        return fakeCanvas(`${url}@${timeSeconds}`);
      },
      dispose() {
        log.push(`dispose ${url}`);
      },
    };
  };
  const thumbnailer = createFrameThumbnailer({
    open,
    encode: async (canvas) => `blob:${(canvas as FakeCanvas).label}`,
    fallback: async (url, timeSeconds) => {
      log.push(`fallback ${url}@${timeSeconds}`);
      return `video:${url}@${timeSeconds}`;
    },
    ...overrides,
  });
  return { thumbnailer, log, maxActive: () => maxActive };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("createFrameThumbnailer", () => {
  it("decodes every thumbnail of a URL from one open source", async () => {
    const { thumbnailer, log, maxActive } = setup();
    const results = await Promise.all(
      [1, 2, 3].map((time) => thumbnailer.generate("a.mp4", time, SIZE)),
    );

    assert.deepEqual(results, ["blob:a.mp4@1", "blob:a.mp4@2", "blob:a.mp4@3"]);
    assert.deepEqual(log, ["open a.mp4"]);
    assert.equal(maxActive(), 1);
  });

  it("falls back for media it cannot decode", async () => {
    const { thumbnailer, log } = setup({
      decodable: (url) => url !== "odd.mkv",
    });

    assert.equal(await thumbnailer.generate("odd.mkv", 4, SIZE), "video:odd.mkv@4");
    assert.deepEqual(log, ["open odd.mkv", "fallback odd.mkv@4"]);
  });

  it("falls back when opening or decoding fails", async () => {
    const { thumbnailer } = setup({
      open: async (url) => {
        if (url === "broken.mp4") {
          throw new Error("unreadable");
        }
        return {
          frameAt: async () => {
            throw new Error("decoder error");
          },
          dispose() {},
        };
      },
    });

    assert.equal(
      await thumbnailer.generate("broken.mp4", 1, SIZE),
      "video:broken.mp4@1",
    );
    assert.equal(await thumbnailer.generate("a.mp4", 2, SIZE), "video:a.mp4@2");
  });

  it("closes the least recently used idle source past the limit", async () => {
    const { thumbnailer, log } = setup({ maxSources: 2 });
    await thumbnailer.generate("a.mp4", 1, SIZE);
    await thumbnailer.generate("b.mp4", 1, SIZE);
    await thumbnailer.generate("a.mp4", 2, SIZE);
    await thumbnailer.generate("c.mp4", 1, SIZE);
    await settle();

    assert.deepEqual(log, [
      "open a.mp4",
      "open b.mp4",
      "open c.mp4",
      "dispose b.mp4",
    ]);
  });

  it("keeps a busy source open until its decodes finish", async () => {
    const { thumbnailer, log } = setup({ maxSources: 1 });
    const first = thumbnailer.generate("a.mp4", 1, SIZE);
    const second = thumbnailer.generate("b.mp4", 1, SIZE);

    assert.deepEqual(await Promise.all([first, second]), [
      "blob:a.mp4@1",
      "blob:b.mp4@1",
    ]);
    await settle();
    assert.deepEqual(log, ["open a.mp4", "open b.mp4", "dispose a.mp4"]);
  });

  it("clear closes idle sources and busy ones once they finish", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { thumbnailer, log } = setup({ gate });
    await thumbnailer.generate("a.mp4", 1, SIZE);
    const busy = thumbnailer.generate("gated.mp4", 1, SIZE);
    thumbnailer.clear();
    await settle();
    assert.deepEqual(log.slice(2), ["dispose a.mp4"]);

    release();
    assert.equal(await busy, "blob:gated.mp4@1");
    await settle();
    assert.deepEqual(log.slice(2), ["dispose a.mp4", "dispose gated.mp4"]);
  });
});
