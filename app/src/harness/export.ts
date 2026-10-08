import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from "mediabunny";
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
import {
  describeExportEncoding,
  MEDIABUNNY_VIDEO_CODECS,
  resolveExportEncoding,
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
    (Object.keys(MEDIABUNNY_VIDEO_CODECS) as EncodableVideoCodec[]).map(
      async (codec) =>
        [
          codec,
          await canEncodeVideo(MEDIABUNNY_VIDEO_CODECS[codec], {
            width,
            height,
            bitrate,
          }).catch(() => false),
        ] as const,
    ),
  );
  return Object.fromEntries(entries);
}

// Exports mix their audio to stereo.
const EXPORT_AUDIO_CHANNELS = 2;

// The zvidlib bridge that writes the final file.
async function loadExportBridge() {
  const bridge = await import("../../export-bridge/pkg/zvid_export_bridge.js");
  await bridge.default();
  return bridge;
}

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

type NativeMux = (
  video: Uint8Array,
  audio: AudioBuffer | null,
  audioBitrate: number,
  cover: Uint8Array | undefined,
) => Promise<Uint8Array>;

export async function exportVideo(
  request: ExportRequest,
  save: (blob: Blob, target: SaveTarget) => Promise<SaveMethod>,
  nativeMux?: NativeMux,
): Promise<ExportResult> {
  const { settings, signal } = request;
  const frameRate = settings.fps;
  const startSeconds = Math.max(0, request.startSeconds ?? 0);
  const encoding = await resolveExportEncoding(settings, (codec, config) =>
    canEncodeVideo(MEDIABUNNY_VIDEO_CODECS[codec], config),
  );
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
  // A WebM's Opus audio is encoded by zvidlib when it writes the file, so
  // only MP4 needs the browser's (or the native) AAC encoder.
  const webm = encoding.container === "webm";
  const containerLabel = EXPORT_CONTAINER_LABELS[encoding.container];
  const browserAac =
    audio && !webm
      ? await canEncodeAudio("aac", {
          sampleRate: audio.sampleRate,
          numberOfChannels: audio.numberOfChannels,
          bitrate: encoding.audioBitrate,
        })
      : false;
  if (audio && !webm && !browserAac && !nativeMux) {
    throw new Error(
      "This browser does not provide an AAC encoder for audible MP4 export.",
    );
  }
  const target = new BufferTarget();
  const output = new Output({
    format: webm ? new WebMOutputFormat() : new Mp4OutputFormat(),
    target,
  });
  const video = new CanvasSource(request.canvas, {
    codec: MEDIABUNNY_VIDEO_CODECS[encoding.videoCodec],
    bitrate: encoding.videoBitrate,
    keyFrameInterval: 2,
    latencyMode: "realtime",
  });
  output.addVideoTrack(video, { frameRate });
  const audioSource =
    audio && browserAac
      ? new AudioBufferSource({
          codec: encoding.audioCodec,
          bitrate: encoding.audioBitrate,
        })
      : null;
  if (audioSource) output.addAudioTrack(audioSource);
  // WebM has no cover art, so only an MP4 takes a thumbnail.
  const thumbnailIndex = webm
    ? -1
    : getThumbnailFrameIndex(request.frameCount, frameRate);
  let thumbnail: HTMLCanvasElement | null = null;
  try {
    await output.start();
    if (audioSource && audio) {
      await audioSource.add(audio);
      audioSource.close();
    }
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
      await video.add(seconds, 1 / frameRate);
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
    video.close();
    await output.finalize();
    if (!target.buffer) throw new Error("Video encoder returned no output.");
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
    let bytes: Uint8Array;
    if (webm) {
      const bridge = await loadExportBridge();
      bytes = await bridge.muxWebm(
        new Uint8Array(target.buffer),
        audio ? interleave(audio) : undefined,
        audio?.numberOfChannels ?? EXPORT_AUDIO_CHANNELS,
        encoding.audioBitrate,
      );
    } else if (nativeMux) {
      bytes = await nativeMux(
        new Uint8Array(target.buffer),
        audioSource ? null : audio,
        encoding.audioBitrate,
        cover,
      );
    } else {
      const bridge = await loadExportBridge();
      bytes = await bridge.muxMp4(new Uint8Array(target.buffer), cover);
    }
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
    };
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  }
}
