// Holds decoded clip media and renders clip spans from it, off the main
// thread (see clip-audio-cache.ts).
import type { DecodedAudio } from "./mix.ts";
import { ClipSpanRenderer, type ClipSpanRequest } from "./clip-span.ts";

export type ClipSpanWorkerMessage =
  | { type: "store"; key: string; media: DecodedAudio }
  | { type: "render"; id: number; key: string; request: ClipSpanRequest };

export type ClipSpanWorkerResponse =
  | { id: number; span: Float32Array[] | null }
  | { id: number; error: string };

// The decoded media it keeps, about five minutes of 48 kHz stereo per
// 100 MB.
const MAX_MEDIA_BYTES = 384 * 1024 * 1024;

const renderer = new ClipSpanRenderer(MAX_MEDIA_BYTES);

self.onmessage = (event: MessageEvent<ClipSpanWorkerMessage>) => {
  const message = event.data;
  if (message.type === "store") {
    renderer.store(message.key, message.media);
    return;
  }
  const { id } = message;
  try {
    const span = renderer.render(message.key, message.request) ?? null;
    self.postMessage({ id, span } satisfies ClipSpanWorkerResponse, {
      transfer: span?.map((channel) => channel.buffer) ?? [],
    });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies ClipSpanWorkerResponse);
  }
};
