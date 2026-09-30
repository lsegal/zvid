import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
} from "mediabunny";
import type {
  EncodableVideoCodec,
  VideoCodecSupport,
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

// Session Settings' codec names, as mediabunny calls them.
const PROBED_CODECS = {
  h264: "avc",
  hevc: "hevc",
  av1: "av1",
} as const satisfies Record<EncodableVideoCodec, string>;

// Which codecs this device can encode at the given size and bitrate. The
// desktop app encodes video in its webview too, so this holds there as well.
export async function probeVideoCodecSupport(
  width: number,
  height: number,
  bitrate: number,
): Promise<VideoCodecSupport> {
  const entries = await Promise.all(
    (Object.keys(PROBED_CODECS) as EncodableVideoCodec[]).map(
      async (codec) =>
        [
          codec,
          await canEncodeVideo(PROBED_CODECS[codec], {
            width,
            height,
            bitrate,
          }).catch(() => false),
        ] as const,
    ),
  );
  return Object.fromEntries(entries);
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
  const { settings } = request;
  const frameRate = settings.fps;
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
  if (request.mainAudio?.hasAudio) {
    request.onProgress({
      phase: "decoding-audio",
      progress: null,
      detail: "Preparing export audio...",
    });
    const response = await fetch(request.mainAudio.previewUrl);
    if (!response.ok)
      throw new Error(`Cannot read export audio (${response.status}).`);
    // Decoding resamples to the context's rate, the export's sample rate.
    const context = new AudioContext({ sampleRate: encoding.audioSampleRate });
    try {
      const decoded = await context.decodeAudioData(
        await response.arrayBuffer(),
      );
      audio = new AudioBuffer({
        numberOfChannels: decoded.numberOfChannels,
        sampleRate: decoded.sampleRate,
        length: Math.ceil(
          (request.frameCount / frameRate) * decoded.sampleRate,
        ),
      });
      for (let channel = 0; channel < audio.numberOfChannels; channel++) {
        audio.copyToChannel(
          decoded.getChannelData(channel).subarray(0, audio.length),
          channel,
        );
      }
    } finally {
      await context.close();
    }
  }
  const browserAac = audio
    ? await canEncodeAudio("aac", {
        sampleRate: audio.sampleRate,
        numberOfChannels: audio.numberOfChannels,
        bitrate: encoding.audioBitrate,
      })
    : false;
  if (audio && !browserAac && !nativeMux) {
    throw new Error(
      "This browser does not provide an AAC encoder for audible MP4 export.",
    );
  }
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
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
  const thumbnailIndex = getThumbnailFrameIndex(request.frameCount, frameRate);
  let thumbnail: HTMLCanvasElement | null = null;
  try {
    await output.start();
    if (audioSource && audio) {
      await audioSource.add(audio);
      audioSource.close();
    }
    for (let index = 0; index < request.frameCount; index++) {
      const seconds = index / frameRate;
      const quarters = (seconds * request.bpm) / 60;
      await request.renderFrameAt(quarters, seconds);
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
        detail: `Rendering frame ${index + 1}/${request.frameCount}...`,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
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
      detail: "Writing final MP4...",
    });
    let bytes: Uint8Array;
    if (nativeMux) {
      bytes = await nativeMux(
        new Uint8Array(target.buffer),
        audioSource ? null : audio,
        encoding.audioBitrate,
        cover,
      );
    } else {
      const bridge = await import(
        "../../export-bridge/pkg/zvid_export_bridge.js"
      );
      await bridge.default();
      bytes = await bridge.muxMp4(new Uint8Array(target.buffer), cover);
    }
    const blob = new Blob([new Uint8Array(bytes)], { type: "video/mp4" });
    return {
      encoding,
      summary,
      bytes: bytes.byteLength,
      mimeType: "video/mp4",
      muxedWith: "zvidlib",
      saveMethod: await save(blob, request.saveTarget),
    };
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  }
}
