// Renders the spans that DecodedClipVoice plays, so voices made again on a
// seek or loop neither fetch nor decode their media again. Rendered spans
// are kept here; decoded media is kept by the clip span worker, which
// renders off the main thread, or by an in-thread renderer where workers
// are unavailable. Each media decodes once however many voices ask for it
// at a time.
import {
  audioBytes,
  BoundedCache,
  type ClipSpan,
  ClipSpanRenderer,
  type ClipSpanRequest,
} from "./clip-span.ts";
import type {
  ClipSpanWorkerMessage,
  ClipSpanWorkerResponse,
} from "./clip-span.worker.ts";
import type { DecodedAudio } from "./mix.ts";
import type { AudioMixClip } from "./resolve.ts";

// Holds decoded media and renders spans from it. A render resolves
// undefined once it no longer holds the media, as after an eviction.
export type ClipSpanBackend = {
  store(key: string, media: DecodedAudio): void;
  render(key: string, request: ClipSpanRequest): Promise<ClipSpan | undefined>;
};

export type ClipSpanSource = {
  clip: AudioMixClip;
  url: string;
  bpm: number;
  sampleRate: number;
};

// The rendered spans kept here, and the decoded media the in-thread
// renderer keeps.
const MAX_SPAN_BYTES = 128 * 1024 * 1024;
const MAX_INLINE_MEDIA_BYTES = 384 * 1024 * 1024;

export class InlineClipSpanBackend implements ClipSpanBackend {
  private readonly renderer: ClipSpanRenderer;

  constructor(maxMediaBytes = MAX_INLINE_MEDIA_BYTES) {
    this.renderer = new ClipSpanRenderer(maxMediaBytes);
  }

  store(key: string, media: DecodedAudio) {
    this.renderer.store(key, media);
  }

  async render(key: string, request: ClipSpanRequest) {
    return this.renderer.render(key, request);
  }
}

// Renders in the clip span worker, falling back to the main thread when the
// worker cannot start or fails. Renders pending when it fails resolve
// undefined, so their media is decoded again for the fallback.
export class WorkerClipSpanBackend implements ClipSpanBackend {
  private worker: Worker | null = null;
  private inline: InlineClipSpanBackend | null = null;
  private readonly pending = new Map<
    number,
    {
      resolve: (span: ClipSpan | undefined) => void;
      reject: (error: Error) => void;
    }
  >();
  private nextId = 1;

  constructor() {
    try {
      this.worker = new Worker(
        new URL("./clip-span.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch {
      this.inline = new InlineClipSpanBackend();
      return;
    }
    this.worker.onmessage = (event: MessageEvent<ClipSpanWorkerResponse>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) {
        return;
      }
      this.pending.delete(event.data.id);
      if ("error" in event.data) {
        pending.reject(new Error(event.data.error));
      } else {
        pending.resolve(event.data.span ?? undefined);
      }
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.fallBack();
    };
  }

  store(key: string, media: DecodedAudio) {
    if (!this.worker) {
      this.inline?.store(key, media);
      return;
    }
    this.worker.postMessage(
      { type: "store", key, media } satisfies ClipSpanWorkerMessage,
      { transfer: media.channels.map((channel) => channel.buffer) },
    );
  }

  render(key: string, request: ClipSpanRequest) {
    const { worker } = this;
    if (!worker) {
      return this.inline?.render(key, request) ?? Promise.resolve(undefined);
    }
    return new Promise<ClipSpan | undefined>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      worker.postMessage({
        type: "render",
        id,
        key,
        request,
      } satisfies ClipSpanWorkerMessage);
    });
  }

  private fallBack() {
    this.worker?.terminate();
    this.worker = null;
    this.inline ??= new InlineClipSpanBackend();
    for (const pending of this.pending.values()) {
      pending.resolve(undefined);
    }
    this.pending.clear();
  }
}

export class ClipAudioCache {
  private readonly spans: BoundedCache<ClipSpan>;
  private readonly pendingSpans = new Map<string, Promise<ClipSpan>>();
  private readonly pendingMedia = new Map<string, Promise<void>>();
  private readonly backend: ClipSpanBackend;

  constructor(backend: ClipSpanBackend, maxSpanBytes = MAX_SPAN_BYTES) {
    this.backend = backend;
    this.spans = new BoundedCache(maxSpanBytes);
  }

  // The clip's span as export reads it, decoding its media with `decode`
  // only when neither the span nor the media is held. The span is shared,
  // so callers copy it rather than change it.
  span(
    source: ClipSpanSource,
    decode: (url: string) => Promise<DecodedAudio>,
  ): Promise<ClipSpan> {
    const { clip, url, bpm, sampleRate } = source;
    const key = JSON.stringify([url, bpm, sampleRate, clip]);
    const cached = this.spans.get(key);
    if (cached) {
      return Promise.resolve(cached);
    }
    const pending = this.pendingSpans.get(key);
    if (pending) {
      return pending;
    }
    const mediaKey = `${clip.mediaId}\n${url}`;
    const request = { clip, bpm, sampleRate };
    const rendering = this.render(mediaKey, request, () => decode(url))
      .then((span) => {
        this.spans.set(key, span, audioBytes(span));
        return span;
      })
      .finally(() => {
        this.pendingSpans.delete(key);
      });
    this.pendingSpans.set(key, rendering);
    return rendering;
  }

  private async render(
    mediaKey: string,
    request: ClipSpanRequest,
    decode: () => Promise<DecodedAudio>,
  ) {
    const span = await this.backend.render(mediaKey, request);
    if (span) {
      return span;
    }
    await this.load(mediaKey, decode);
    const loaded = await this.backend.render(mediaKey, request);
    if (!loaded) {
      throw new Error("The clip audio was dropped before it rendered.");
    }
    return loaded;
  }

  private load(mediaKey: string, decode: () => Promise<DecodedAudio>) {
    let loading = this.pendingMedia.get(mediaKey);
    if (!loading) {
      loading = decode()
        .then((media) => {
          this.backend.store(mediaKey, media);
        })
        .finally(() => {
          this.pendingMedia.delete(mediaKey);
        });
      this.pendingMedia.set(mediaKey, loading);
    }
    return loading;
  }
}

let shared: ClipAudioCache | null = null;

// The cache every preview voice shares.
export function sharedClipAudioCache() {
  shared ??= new ClipAudioCache(new WorkerClipSpanBackend());
  return shared;
}
