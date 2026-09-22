import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
} from "mediabunny";
import type {
  ExportRequest,
  ExportResult,
  SaveMethod,
  SaveTarget,
} from "./contracts";

type NativeMux = (
  video: Uint8Array,
  audio: AudioBuffer | null,
) => Promise<Uint8Array>;

export async function exportVideo(
  request: ExportRequest,
  save: (blob: Blob, target: SaveTarget) => Promise<SaveMethod>,
  nativeMux?: NativeMux,
): Promise<ExportResult> {
  const codec = (await canEncodeVideo("hevc", {
    width: request.canvasWidth,
    height: request.canvasHeight,
    bitrate: QUALITY_HIGH,
  }))
    ? "hevc"
    : (await canEncodeVideo("av1", {
          width: request.canvasWidth,
          height: request.canvasHeight,
          bitrate: QUALITY_HIGH,
        }))
      ? "av1"
      : null;
  if (!codec)
    throw new Error(
      "MP4 export requires a HEVC or AV1 encoder in this runtime.",
    );
  let audio: AudioBuffer | null = null;
  if (request.masterAudio?.hasAudio) {
    request.onProgress({
      phase: "decoding-audio",
      progress: null,
      detail: "Preparing export audio...",
    });
    const response = await fetch(request.masterAudio.previewUrl);
    if (!response.ok)
      throw new Error(`Cannot read export audio (${response.status}).`);
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(
        await response.arrayBuffer(),
      );
      audio = new AudioBuffer({
        numberOfChannels: decoded.numberOfChannels,
        sampleRate: decoded.sampleRate,
        length: Math.ceil(
          (request.frameCount / request.frameRate) * decoded.sampleRate,
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
    codec,
    bitrate: QUALITY_HIGH,
    keyFrameInterval: 2,
    latencyMode: "realtime",
  });
  output.addVideoTrack(video, { frameRate: request.frameRate });
  const audioSource =
    audio && browserAac
      ? new AudioBufferSource({ codec: "aac", bitrate: 192_000 })
      : null;
  if (audioSource) output.addAudioTrack(audioSource);
  try {
    await output.start();
    if (audioSource && audio) {
      await audioSource.add(audio);
      audioSource.close();
    }
    for (let index = 0; index < request.frameCount; index++) {
      const seconds = index / request.frameRate;
      const quarters = (seconds * request.bpm) / 60;
      await request.renderFrameAt(quarters, seconds);
      await video.add(seconds, 1 / request.frameRate);
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
      );
    } else {
      const bridge = await import(
        "../../export-bridge/pkg/zvid_export_bridge.js"
      );
      await bridge.default();
      bytes = await bridge.muxMp4(new Uint8Array(target.buffer));
    }
    const blob = new Blob([new Uint8Array(bytes)], { type: "video/mp4" });
    return {
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
