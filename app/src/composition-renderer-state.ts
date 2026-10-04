import type { AudioMix } from "./audio-mix/resolve.ts";
import type {
  ArrangementClip,
  Lane,
  MediaItem,
  SessionEffect,
} from "./composition-active-clips.ts";
import type { MeterSignature } from "./timeline-format.ts";

// What a CompositionRenderer draws: the project's media, clips and effects
// at its tempo and output size.
export type CompositionRendererState = {
  mediaItems: MediaItem[];
  clips: ArrangementClip[];
  lanes: Lane[];
  effects: SessionEffect[];
  bpm: number;
  fps: number;
  signature?: MeterSignature;
  projectDurationFrames?: number;
  canvasWidth: number;
  canvasHeight: number;
  audioMix?: AudioMix;
  // Draws this text clip with no text: it keeps its slot, and its layer's
  // effects, but its text doesn't show twice under the editor.
  hiddenTextClipId?: string;
};
