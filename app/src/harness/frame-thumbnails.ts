// Decodes timeline thumbnails from one open decoder per media URL instead of
// a new <video> per thumbnail. Safari paints a <video> that was never shown by
// waiting up to a second for a frame, on the main thread, so a filmstrip of
// such thumbnails froze the whole app there (#617).
//
// Decodes for one URL run one at a time, since they share a decoder and its
// canvas. A URL whose media cannot be decoded, or a decode that fails, falls
// back to `fallback`.

export type ThumbnailFrameSize = { width: number; height: number };

type FrameCanvas = HTMLCanvasElement | OffscreenCanvas;

export type FrameSource = {
  // The frame shown at `timeSeconds`, scaled to cover `size`, or null when
  // there is none. The canvas may be reused by the next call.
  frameAt(
    timeSeconds: number,
    size: ThumbnailFrameSize,
  ): Promise<FrameCanvas | null>;
  dispose(): void;
};

export type FrameThumbnailerOptions = {
  // Opens a decoder for `url`, or resolves null when its media cannot be
  // decoded this way.
  open(url: string): Promise<FrameSource | null>;
  // Encodes a frame into an object URL.
  encode(canvas: FrameCanvas): Promise<string>;
  fallback(
    url: string,
    timeSeconds: number,
    size: ThumbnailFrameSize,
  ): Promise<string | undefined>;
  // How many decoders stay open. The least recently used idle one closes
  // when another opens.
  maxSources?: number;
};

export type FrameThumbnailer = {
  generate(
    url: string,
    timeSeconds: number,
    size: ThumbnailFrameSize,
  ): Promise<string | undefined>;
  // Closes every idle decoder; busy ones close once their decodes finish.
  clear(): void;
};

export const DEFAULT_MAX_FRAME_SOURCES = 4;

type SourceEntry = {
  source: Promise<FrameSource | null>;
  queue: Promise<unknown>;
  pending: number;
  closed: boolean;
};

export function createFrameThumbnailer(
  options: FrameThumbnailerOptions,
): FrameThumbnailer {
  const maxSources = options.maxSources ?? DEFAULT_MAX_FRAME_SOURCES;
  // Kept in least recently used order.
  const entries = new Map<string, SourceEntry>();

  const close = (url: string, entry: SourceEntry) => {
    if (entries.get(url) === entry) {
      entries.delete(url);
    }
    entry.closed = true;
    void entry.source.then(
      (source) => source?.dispose(),
      () => {},
    );
  };

  const evictIdle = () => {
    for (const [url, entry] of entries) {
      if (entries.size <= maxSources) {
        return;
      }
      if (entry.pending === 0) {
        close(url, entry);
      }
    }
  };

  const entryFor = (url: string) => {
    let entry = entries.get(url);
    if (entry) {
      entries.delete(url);
    } else {
      const source = options.open(url).catch(() => null);
      entry = { source, queue: source, pending: 0, closed: false };
    }
    entries.set(url, entry);
    return entry;
  };

  const decode = async (
    entry: SourceEntry,
    url: string,
    timeSeconds: number,
    size: ThumbnailFrameSize,
  ) => {
    const source = await entry.source;
    if (source) {
      try {
        const canvas = await source.frameAt(timeSeconds, size);
        if (canvas) {
          return await options.encode(canvas);
        }
      } catch {
        // Falls back below.
      }
    }
    return options.fallback(url, timeSeconds, size);
  };

  return {
    generate(url, timeSeconds, size) {
      const entry = entryFor(url);
      entry.pending += 1;
      const result = entry.queue.then(
        () => decode(entry, url, timeSeconds, size),
        () => decode(entry, url, timeSeconds, size),
      );
      entry.queue = result.catch(() => {});
      void entry.queue.then(() => {
        entry.pending -= 1;
        // Cleared while busy: close now that its decodes are done.
        if (entries.get(url) !== entry) {
          if (entry.pending === 0 && !entry.closed) {
            close(url, entry);
          }
        } else {
          evictIdle();
        }
      });
      evictIdle();
      return result;
    },
    clear() {
      for (const [url, entry] of [...entries]) {
        entries.delete(url);
        if (entry.pending === 0) {
          close(url, entry);
        }
      }
    },
  };
}
