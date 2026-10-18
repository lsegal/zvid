import { renderAudioMixOffline } from "../audio-mix/offline";
import {
  type EncodableVideoCodec,
  EXPORT_CONTAINER_LABELS,
  type VideoCodecSupport,
} from "../session-settings";
import type {
  ExportRequest,
  ExportResult,
  SaveMethod,
  SaveTarget,
} from "./contracts";
import { canEncodeVideo, loadExportBridge } from "./export-bridge";
import {
  describeExportEncoding,
  resolveExportEncoding,
  VIDEO_CODEC_LABELS,
} from "./export-encoding";
import {
  drawThumbnail,
  encodeThumbnail,
  getThumbnailFrameIndex,
} from "./export-thumbnail";

// Which codecs this device can encode at the given size and bitrate. The
// desktop app encodes video in its webview too, so this holds there as well.
export async function probeVideoCodecSupport(
  width: number,
  height: number,
  bitrate: number,
): Promise<VideoCodecSupport> {
  const entries = await Promise.all(
    (Object.keys(VIDEO_CODEC_LABELS) as EncodableVideoCodec[]).map(
      async (codec) =>
        [
          codec,
          await canEncodeVideo(codec, { width, height, bitrate }).catch(
            () => false,
          ),
        ] as const,
    ),
  );
  return Object.fromEntries(entries);
}

// Exports mix their audio to stereo.
const EXPORT_AUDIO_CHANNELS = 2;

// The buffer's channels interleaved, as zvidlib's encoders take them.
function interleave(audio: AudioBuffer) {
  const channels = audio.numberOfChannels;
  const samples = new Float32Array(audio.length * channels);
  for (let channel = 0; channel < channels; channel++) {
    const data = audio.getChannelData(channel);
    for (let index = 0; index < data.length; index++) {
      samples[index * channels + channel] = data[index];
    }
  }
  return samples;
}

export async function exportVideo(
  request: ExportRequest,
  save: (blob: Blob, target: SaveTarget) => Promise<SaveMethod>,
): Promise<ExportResult> {
  const { settings, signal } = request;
  const frameRate = settings.fps;
  const startSeconds = Math.max(0, request.startSeconds ?? 0);
  const encoding = await resolveExportEncoding(settings, canEncodeVideo);
  const summary = describeExportEncoding(settings, encoding);
  request.onLog?.("export:encoding", { ...encoding, summary });
  request.onProgress({
    phase: "preparing",
    progress: null,
    detail: `Exporting ${summary}...`,
  });
  let audio: AudioBuffer | null = null;
  if (request.audio) {
    request.onProgress({
      phase: "decoding-audio",
      progress: null,
      detail: "Preparing export audio...",
    });
    // The mix covers the exported range, like the video.
    const sampleRate = encoding.audioSampleRate;
    const channels = await renderAudioMixOffline(
      request.audio.mix,
      request.audio.mediaItems,
      {
        sampleRate,
        numberOfChannels: EXPORT_AUDIO_CHANNELS,
        startSeconds,
        length: Math.ceil((request.frameCount / frameRate) * sampleRate),
      },
    );
    if (channels) {
      audio = new AudioBuffer({
        numberOfChannels: channels.length,
        sampleRate,
        length: channels[0].length,
      });
      channels.forEach((data, channel) => {
        audio?.copyToChannel(data, channel);
      });
    }
  }
  // zvidlib encodes a WebM's Opus audio itself, so only MP4 needs the
  // device's AAC encoder.
  const webm = encoding.container === "webm";
  const containerLabel = EXPORT_CONTAINER_LABELS[encoding.container];
  const bridge = await loadExportBridge();
  if (
    audio &&
    !webm &&
    !(await bridge.canEncodeAac(
      audio.sampleRate,
      audio.numberOfChannels,
      encoding.audioBitrate,
    ))
  ) {
    throw new Error(
      "This browser does not provide an AAC encoder for audible MP4 export.",
    );
  }
  const encoder = await bridge.createExportEncoder(
    encoding.videoCodec,
    settings.canvasWidth,
    settings.canvasHeight,
    encoding.videoBitrate,
    frameRate,
  );
  // WebM has no cover art, so only an MP4 takes a thumbnail.
  const thumbnailIndex = webm
    ? -1
    : getThumbnailFrameIndex(request.frameCount, frameRate);
  let thumbnail: HTMLCanvasElement | null = null;
  try {
    for (let index = 0; index < request.frameCount; index++) {
      signal?.throwIfAborted();
      // `seconds` is the frame's time in the output; it shows the session
      // at `sessionSeconds`.
      const seconds = index / frameRate;
      const sessionSeconds = startSeconds + seconds;
      const quarters = (sessionSeconds * request.bpm) / 60;
      await request.renderFrameAt(quarters, sessionSeconds);
      if (index === thumbnailIndex) {
        try {
          thumbnail = drawThumbnail(request.canvas);
        } catch (error) {
          request.onLog?.("export:thumbnail-failed", String(error));
        }
      }
      await encoder.addFrame(request.canvas);
      request.setPlayheadQ(quarters);
      request.onProgress({
        phase: "rendering",
        progress: Math.round(((index + 1) / request.frameCount) * 100),
        detail: `Rendering frame ${index + 1}/${request.frameCount} · ${summary}...`,
      });
      await (request.yieldBetweenFrames?.() ??
        new Promise((resolve) => setTimeout(resolve, 0)));
    }
    signal?.throwIfAborted();
    // A missing thumbnail only costs the file-browser preview, so export
    // without one instead of failing.
    const cover = thumbnail
      ? await encodeThumbnail(thumbnail).catch((error) => {
          request.onLog?.("export:thumbnail-failed", String(error));
          return undefined;
        })
      : undefined;
    request.onProgress({
      phase: "muxing",
      progress: null,
      detail: `Writing final ${containerLabel}...`,
      container: encoding.container,
    });
    const bytes: Uint8Array = await encoder.finish(
      audio ? interleave(audio) : undefined,
      audio?.numberOfChannels ?? EXPORT_AUDIO_CHANNELS,
      audio?.sampleRate ?? encoding.audioSampleRate,
      encoding.audioBitrate,
      cover,
    );
    signal?.throwIfAborted();
    const mimeType = `video/${encoding.container}`;
    const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
    return {
      encoding,
      summary,
      bytes: bytes.byteLength,
      mimeType,
      muxedWith: "zvidlib",
      saveMethod: await save(blob, request.saveTarget),
      blob,
    };
  } finally {
    encoder.close();
    encoder.free();
  }
}
