import {
  buildFallbackWaveform,
  createMediaId,
  inferMediaKind,
  type MediaItem,
  type Palette,
} from "../media";
import type { ServerMediaRef } from "../session";
import type {
  ExportRequest,
  ExportResult,
  MediaSelection,
  SaveMethod,
  SaveTarget,
} from "./contracts";

const FFMPEG_CORE_URL = "/ffmpeg/ffmpeg-core.js";
const FFMPEG_WASM_URL = "/ffmpeg/ffmpeg-core.wasm";

type WebMediaRuntime = {
  FFmpeg: typeof import("@ffmpeg/ffmpeg").FFmpeg;
  toBlobURL: typeof import("@ffmpeg/util").toBlobURL;
  mediabunny: typeof import("mediabunny");
};

type MediaAnalysisOptions = {
  id: string;
  name: string;
  previewUrl: string;
  palette: Palette;
  sourcePath?: string;
};

let runtimePromise: Promise<WebMediaRuntime> | null = null;
let ffmpegRef: import("@ffmpeg/ffmpeg").FFmpeg | null = null;
let ffmpegLoadRef: Promise<void> | null = null;
let ffmpegAssetUrlsRef: { coreURL: string; wasmURL: string } | null = null;

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

async function canvasToObjectUrl(canvas: HTMLCanvasElement | OffscreenCanvas) {
  if ("convertToBlob" in canvas) {
    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: 0.82,
    });
    return URL.createObjectURL(blob);
  }

  const element = canvas as HTMLCanvasElement;
  const blob = await new Promise<Blob>((resolve, reject) => {
    element.toBlob(
      (result) => {
        if (!result) {
          reject(new Error("Failed to create thumbnail blob"));
          return;
        }
        resolve(result);
      },
      "image/jpeg",
      0.82,
    );
  });

  return URL.createObjectURL(blob);
}

function drawVideoFrameCover(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
) {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to acquire canvas context for thumbnail rendering");
  }

  canvas.width = width;
  canvas.height = height;

  const sourceWidth = Math.max(1, video.videoWidth || width);
  const sourceHeight = Math.max(1, video.videoHeight || height);
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = width / height;

  let drawWidth = width;
  let drawHeight = height;
  let drawX = 0;
  let drawY = 0;

  if (sourceAspect > targetAspect) {
    drawHeight = height;
    drawWidth = height * sourceAspect;
    drawX = (width - drawWidth) / 2;
  } else {
    drawWidth = width;
    drawHeight = width / sourceAspect;
    drawY = (height - drawHeight) / 2;
  }

  context.clearRect(0, 0, width, height);
  context.drawImage(video, drawX, drawY, drawWidth, drawHeight);
}

export async function generateThumbnailFromUrlAtTime(
  url: string,
  timeSeconds: number,
  options?: {
    width?: number;
    height?: number;
  },
) {
  const width = options?.width ?? 240;
  const height = options?.height ?? 420;

  return new Promise<string | undefined>((resolve) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    let settled = false;
    let timeoutId = 0;

    const settle = (result?: string) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleFailure);
      resolve(result);
    };

    const handleFailure = () => {
      settle(undefined);
    };

    const handleSeeked = async () => {
      try {
        drawVideoFrameCover(video, canvas, width, height);
        settle(await canvasToObjectUrl(canvas));
      } catch {
        settle(undefined);
      }
    };

    const handleLoadedMetadata = () => {
      const duration = Number.isFinite(video.duration)
        ? Math.max(0, video.duration)
        : 0;
      const targetTime =
        duration > 0
          ? Math.min(Math.max(0, timeSeconds), Math.max(0, duration - 0.05))
          : Math.max(0, timeSeconds);

      if (Math.abs(targetTime - video.currentTime) <= 0.001) {
        void handleSeeked();
        return;
      }

      try {
        video.currentTime = targetTime;
      } catch {
        settle(undefined);
      }
    };

    timeoutId = window.setTimeout(handleFailure, 8000);
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.addEventListener("loadedmetadata", handleLoadedMetadata, {
      once: true,
    });
    video.addEventListener("seeked", handleSeeked, { once: true });
    video.addEventListener("error", handleFailure, { once: true });
    video.src = url;
  });
}

function toArrayBuffer(data: Uint8Array | string) {
  if (typeof data === "string") {
    return new TextEncoder().encode(data).buffer;
  }

  const normalized = new Uint8Array(data.byteLength);
  normalized.set(data);
  return normalized.buffer;
}

function blobToUint8Array(blob: Blob) {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function concatAudioBuffers(buffers: AudioBuffer[]) {
  if (!buffers.length) {
    return null;
  }

  const channelCount = Math.max(
    ...buffers.map((buffer) => buffer.numberOfChannels),
  );
  const sampleRate = buffers[0].sampleRate;
  const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
  const context = new OfflineAudioContext(
    channelCount,
    Math.max(1, totalLength),
    sampleRate,
  );
  const combined = context.createBuffer(
    channelCount,
    Math.max(1, totalLength),
    sampleRate,
  );
  let offset = 0;

  for (const buffer of buffers) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const sourceChannel = Math.min(channelIndex, buffer.numberOfChannels - 1);
      combined
        .getChannelData(channelIndex)
        .set(buffer.getChannelData(sourceChannel), offset);
    }

    offset += buffer.length;
  }

  return combined;
}

function encodeAudioBufferAsWav(audioBuffer: AudioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const sampleCount = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = sampleCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;

  const writeString = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset, value.charCodeAt(index));
      offset += 1;
    }
  };

  writeString("RIFF");
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeString("WAVE");
  writeString("fmt ");
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, channelCount, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, byteRate, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true);
  offset += 2;
  writeString("data");
  view.setUint32(offset, dataSize, true);
  offset += 4;

  const channels = Array.from({ length: channelCount }, (_, index) =>
    audioBuffer.getChannelData(index),
  );
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const sample = channels[channelIndex]?.[sampleIndex] ?? 0;
      const clamped = Math.max(-1, Math.min(1, sample));
      const encoded = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      view.setInt16(offset, Math.round(encoded), true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}

async function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = Promise.all([
      import("@ffmpeg/ffmpeg"),
      import("@ffmpeg/util"),
      import("mediabunny"),
    ]).then(([ffmpeg, ffmpegUtil, mediabunny]) => ({
      FFmpeg: ffmpeg.FFmpeg,
      toBlobURL: ffmpegUtil.toBlobURL,
      mediabunny,
    }));
  }

  return runtimePromise;
}

async function sampleWaveform(
  seed: string,
  input: import("mediabunny").Input,
  runtime: WebMediaRuntime,
  points = 96,
) {
  const { AudioBufferSink } = runtime.mediabunny;
  const audioTrack = await input.getPrimaryAudioTrack();
  if (!audioTrack) {
    return buildFallbackWaveform(seed, points);
  }

  const duration = Math.max(0.01, await input.computeDuration());
  const sink = new AudioBufferSink(audioTrack);
  const timestamps = Array.from(
    { length: points },
    (_, index) => duration * (index / Math.max(1, points - 1)),
  );
  const waveform: number[] = [];

  for await (const wrapped of sink.buffersAtTimestamps(timestamps)) {
    if (!wrapped) {
      waveform.push(0);
      continue;
    }

    const channel = wrapped.buffer.getChannelData(0);
    let peak = 0;
    for (let index = 0; index < channel.length; index += 1) {
      peak = Math.max(peak, Math.abs(channel[index] ?? 0));
    }

    waveform.push(Math.min(1, peak));
  }

  return waveform.some((value) => value > 0.001)
    ? waveform
    : buildFallbackWaveform(seed, points);
}

async function decodeAudioBufferFromUrl(
  url: string,
  durationSeconds: number,
  runtime: WebMediaRuntime,
  onProgress?: (progress: number, detail: string) => void,
) {
  const { ALL_FORMATS, AudioBufferSink, Input, UrlSource } = runtime.mediabunny;
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(url),
  });

  try {
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) {
      return null;
    }

    const sink = new AudioBufferSink(audioTrack);
    const decodedBuffers: AudioBuffer[] = [];
    let decodedChunks = 0;

    for await (const wrapped of sink.buffers(
      0,
      durationSeconds > 0 ? durationSeconds : undefined,
    )) {
      decodedBuffers.push(wrapped.buffer);
      decodedChunks += 1;

      if (onProgress) {
        const completion = Math.max(
          0,
          Math.min(
            100,
            Math.round(
              (((wrapped.timestamp ?? 0) + (wrapped.duration ?? 0)) /
                Math.max(0.01, durationSeconds)) *
                100,
            ),
          ),
        );
        onProgress(
          completion,
          `Decoding master audio for export (${completion}%)...`,
        );
      }

      if (decodedChunks % 8 === 0) {
        await yieldToBrowser();
      }
    }

    return concatAudioBuffers(decodedBuffers);
  } finally {
    input.dispose();
  }
}

async function analyzeInputMedia(
  input: import("mediabunny").Input,
  options: MediaAnalysisOptions,
  runtime: WebMediaRuntime,
): Promise<MediaItem> {
  const { CanvasSink } = runtime.mediabunny;

  try {
    const durationSeconds = await input.computeDuration();
    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack();

    let thumbnailUrl: string | undefined;
    let fps: number | undefined;

    if (videoTrack) {
      const sink = new CanvasSink(videoTrack, {
        width: 240,
        height: 420,
        fit: "cover",
        poolSize: 1,
      });
      const timestamp = Math.min(
        Math.max(durationSeconds * 0.18, 0.1),
        Math.max(durationSeconds - 0.05, 0.1),
      );
      const wrappedCanvas = await sink.getCanvas(timestamp);
      if (wrappedCanvas) {
        thumbnailUrl = await canvasToObjectUrl(wrappedCanvas.canvas);
      }

      fps = (await videoTrack.computePacketStats(240)).averagePacketRate;
    }

    const waveform = await sampleWaveform(options.name, input, runtime);

    return {
      id: options.id,
      name: options.name,
      kind: videoTrack ? "video" : "audio",
      durationSeconds,
      width: videoTrack?.displayWidth,
      height: videoTrack?.displayHeight,
      fps,
      sampleRate: audioTrack?.sampleRate,
      channels: audioTrack?.numberOfChannels,
      hasAudio: Boolean(audioTrack),
      hasVideo: Boolean(videoTrack),
      color: options.palette.color,
      accent: options.palette.accent,
      waveform,
      previewUrl: options.previewUrl,
      thumbnailUrl,
      sourcePath: options.sourcePath,
      availability: "ready",
    };
  } finally {
    input.dispose();
  }
}

async function loadMediaElementMetadata(
  url: string,
  preferredKind: "video" | "audio",
): Promise<{
  kind: "video" | "audio";
  durationSeconds: number;
  width?: number;
  height?: number;
} | null> {
  return new Promise((resolve) => {
    const element =
      preferredKind === "video"
        ? document.createElement("video")
        : document.createElement("audio");
    let settled = false;
    let timeoutId = 0;

    const settle = (
      result: {
        kind: "video" | "audio";
        durationSeconds: number;
        width?: number;
        height?: number;
      } | null,
    ) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      element.removeAttribute("src");
      element.load();
      element.removeEventListener("loadedmetadata", handleLoadedMetadata);
      element.removeEventListener("error", handleFailure);
      resolve(result);
    };

    const handleLoadedMetadata = () => {
      const durationSeconds = Number.isFinite(element.duration)
        ? Math.max(0, element.duration)
        : 0;
      if (preferredKind === "video" && element instanceof HTMLVideoElement) {
        const hasVisibleVideo =
          element.videoWidth > 0 && element.videoHeight > 0;
        settle({
          kind: hasVisibleVideo ? "video" : "audio",
          durationSeconds,
          width: hasVisibleVideo ? element.videoWidth : undefined,
          height: hasVisibleVideo ? element.videoHeight : undefined,
        });
        return;
      }

      settle({
        kind: preferredKind,
        durationSeconds,
      });
    };

    const handleFailure = () => {
      settle(null);
    };

    timeoutId = window.setTimeout(handleFailure, 5000);
    element.preload = "metadata";
    element.addEventListener("loadedmetadata", handleLoadedMetadata, {
      once: true,
    });
    element.addEventListener("error", handleFailure, { once: true });
    element.src = url;
  });
}

async function createMetadataFallbackItem(
  options: MediaAnalysisOptions,
): Promise<MediaItem> {
  const guessedKind = inferMediaKind(options.name);
  const candidates =
    guessedKind === "video"
      ? (["video", "audio"] as const)
      : (["audio", "video"] as const);

  for (const candidate of candidates) {
    const metadata = await loadMediaElementMetadata(
      options.previewUrl,
      candidate,
    );
    if (!metadata) {
      continue;
    }

    return {
      id: options.id,
      name: options.name,
      kind: metadata.kind,
      durationSeconds: metadata.durationSeconds,
      width: metadata.width,
      height: metadata.height,
      hasAudio: metadata.kind === "audio",
      hasVideo: metadata.kind === "video",
      color: options.palette.color,
      accent: options.palette.accent,
      waveform: buildFallbackWaveform(options.name),
      previewUrl: options.previewUrl,
      sourcePath: options.sourcePath,
      availability: "ready",
    };
  }

  return {
    id: options.id,
    name: options.name,
    kind: guessedKind,
    durationSeconds: 0,
    hasAudio: guessedKind === "audio",
    hasVideo: guessedKind === "video",
    color: options.palette.color,
    accent: options.palette.accent,
    waveform: buildFallbackWaveform(options.name),
    previewUrl: options.previewUrl,
    sourcePath: options.sourcePath,
    availability: "ready",
  };
}

async function analyzeLocalMediaFile(
  file: File,
  palette: Palette,
  runtime: WebMediaRuntime,
) {
  const previewUrl = URL.createObjectURL(file);
  const options: MediaAnalysisOptions = {
    id: createMediaId(file),
    name: file.name,
    previewUrl,
    palette,
  };
  const { ALL_FORMATS, BlobSource, Input } = runtime.mediabunny;

  try {
    return await analyzeInputMedia(
      new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(file),
      }),
      options,
      runtime,
    );
  } catch (error) {
    console.warn(
      "[zvid] Falling back to HTML media metadata for local file analysis.",
      {
        name: file.name,
        error,
      },
    );
    return createMetadataFallbackItem(options);
  }
}

async function analyzeServerMediaRef(
  ref: ServerMediaRef,
  palette: Palette,
  runtime: WebMediaRuntime,
) {
  const { ALL_FORMATS, Input, UrlSource } = runtime.mediabunny;
  const options: MediaAnalysisOptions = {
    id: ref.id,
    name: ref.name,
    previewUrl: ref.url,
    palette,
    sourcePath: ref.path,
  };

  try {
    return await analyzeInputMedia(
      new Input({
        formats: ALL_FORMATS,
        source: new UrlSource(ref.url),
      }),
      options,
      runtime,
    );
  } catch (error) {
    console.warn(
      "[zvid] Falling back to HTML media metadata for session media analysis.",
      {
        path: ref.path,
        error,
      },
    );
    return createMetadataFallbackItem(options);
  }
}

export async function analyzeMediaSelection(
  selection: MediaSelection,
  palettes: Palette[],
  startIndex: number,
) {
  const runtime = await loadRuntime();

  return selection.kind === "files"
    ? Promise.all(
        selection.files.map((file, index) =>
          analyzeLocalMediaFile(
            file,
            palettes[(startIndex + index) % palettes.length] ?? palettes[0],
            runtime,
          ),
        ),
      )
    : Promise.all(
        selection.refs.map((ref, index) =>
          analyzeServerMediaRef(
            ref,
            palettes[(startIndex + index) % palettes.length] ?? palettes[0],
            runtime,
          ),
        ),
      );
}

async function ensureFfmpeg(request: ExportRequest, runtime: WebMediaRuntime) {
  if (ffmpegRef?.loaded) {
    return ffmpegRef;
  }

  if (!ffmpegRef) {
    const ffmpeg = new runtime.FFmpeg();
    ffmpeg.on("log", ({ message }) => {
      request.onLog?.("ffmpeg:log", { message });
    });
    ffmpeg.on("progress", ({ progress, time }) => {
      request.onLog?.("ffmpeg:progress", { progress, time });
      const completion = Math.max(0, Math.min(100, Math.round(progress * 100)));
      request.onProgress({
        phase: "muxing",
        progress: completion,
        detail: `Muxing audio into final MP4 with ffmpeg.wasm (${completion}%)...`,
      });
    });
    ffmpegRef = ffmpeg;
  }

  if (!ffmpegLoadRef) {
    request.onProgress({
      phase: "loading-ffmpeg",
      progress: 0,
      detail: "Loading ffmpeg.wasm core...",
    });
    request.onLog?.("export:phase", { phase: "loading-ffmpeg" });
    const assetUrlsPromise = ffmpegAssetUrlsRef
      ? Promise.resolve(ffmpegAssetUrlsRef)
      : Promise.all([
          runtime.toBlobURL(FFMPEG_CORE_URL, "text/javascript", true),
          runtime.toBlobURL(FFMPEG_WASM_URL, "application/wasm", true),
        ]).then(([coreURL, wasmURL]) => {
          const next = { coreURL, wasmURL };
          ffmpegAssetUrlsRef = next;
          return next;
        });

    ffmpegLoadRef = ffmpegRef
      .load(await assetUrlsPromise)
      .then(() => undefined)
      .finally(() => {
        ffmpegLoadRef = null;
      });
  }

  await ffmpegLoadRef;
  return ffmpegRef;
}

export async function exportVideo(
  request: ExportRequest,
  saveBlob: (blob: Blob, target: SaveTarget) => Promise<SaveMethod>,
): Promise<ExportResult> {
  const runtime = await loadRuntime();
  const {
    BufferTarget,
    CanvasSource,
    Mp4OutputFormat,
    Output,
    QUALITY_HIGH,
    canEncodeVideo,
  } = runtime.mediabunny;

  request.onProgress({
    phase: "preparing",
    progress: null,
    detail: "Checking H.264 encoder support...",
  });
  request.onLog?.("export:phase", { phase: "encoder-check:start" });
  const canEncodeAvc = await canEncodeVideo("avc", {
    width: request.canvasWidth,
    height: request.canvasHeight,
    bitrate: QUALITY_HIGH,
  });
  request.onLog?.("export:phase", {
    phase: "encoder-check:complete",
    supported: canEncodeAvc,
  });
  if (!canEncodeAvc) {
    throw new Error("This runtime cannot encode H.264 video for MP4 export.");
  }

  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  const videoSource = new CanvasSource(request.canvas, {
    codec: "avc",
    bitrate: QUALITY_HIGH,
    keyFrameInterval: 2,
    sizeChangeBehavior: "cover",
  });
  output.addVideoTrack(videoSource, {
    frameRate: request.frameRate,
    name: "Program",
  });

  request.onProgress({
    phase: "preparing",
    progress: null,
    detail: "Starting MediaBunny MP4 encoder...",
  });
  request.onLog?.("export:phase", { phase: "output-start:start" });
  await output.start();
  request.onLog?.("export:phase", { phase: "output-start:complete" });
  let intermediateMimeType = "video/mp4";
  request.onProgress({
    phase: "rendering",
    progress: null,
    detail: `Rendering ${request.frameCount} frame(s) from the render surface...`,
  });
  request.onLog?.("export:phase", {
    phase: "rendering",
    frames: request.frameCount,
  });

  for (let frameIndex = 0; frameIndex < request.frameCount; frameIndex += 1) {
    const frameSeconds = Math.min(
      request.durationSeconds,
      frameIndex * request.frameDuration,
    );
    const frameQ = (frameSeconds * request.bpm) / 60;
    if (frameIndex === 0) {
      request.onProgress({
        phase: "rendering",
        progress: null,
        detail: `Rendering frame 1/${request.frameCount}...`,
      });
      request.onLog?.("export:first-frame:start", {
        frame: 1,
        seconds: frameSeconds,
        quarters: frameQ,
      });
      await yieldToBrowser();
    }

    await request.renderFrameAt(frameQ, frameSeconds);
    await videoSource.add(frameSeconds, request.frameDuration);
    if (frameIndex === 0) {
      request.onLog?.("export:first-frame:complete", { frame: 1 });
    }
    await yieldToBrowser();

    if (
      frameIndex === 0 ||
      frameIndex === request.frameCount - 1 ||
      frameIndex % Math.max(1, Math.floor(request.frameRate)) === 0
    ) {
      const completion = Math.round(
        ((frameIndex + 1) / request.frameCount) * 100,
      );
      request.setPlayheadQ(frameQ);
      request.onProgress({
        phase: "rendering",
        progress: completion,
        detail: `Rendering ${frameIndex + 1}/${request.frameCount} frames (${completion}%)...`,
      });
      request.onLog?.("export:progress", {
        frame: frameIndex + 1,
        totalFrames: request.frameCount,
        completion,
      });
      await yieldToBrowser();
    }
  }

  videoSource.close();
  await output.finalize();
  intermediateMimeType = await output.getMimeType().catch(() => "video/mp4");

  const intermediateBuffer = output.target.buffer;
  if (!intermediateBuffer) {
    throw new Error("MediaBunny did not return an output buffer.");
  }

  let masterAudioBuffer: AudioBuffer | null = null;
  if (request.masterAudio?.previewUrl && request.masterAudio.hasAudio) {
    request.onProgress({
      phase: "decoding-audio",
      progress: null,
      detail: "Decoding master audio for export...",
    });
    request.onLog?.("export:phase", { phase: "decoding-audio" });
    masterAudioBuffer = await decodeAudioBufferFromUrl(
      request.masterAudio.previewUrl,
      request.durationSeconds,
      runtime,
      (progress, detail) => {
        request.onProgress({
          phase: "decoding-audio",
          progress,
          detail,
        });
        request.onLog?.("export:audioDecodeProgress", { progress });
      },
    );
    if (!masterAudioBuffer) {
      request.onLog?.("export:audioSkipped", {
        reason: "No decodable primary audio track.",
      });
    }
  }

  if (masterAudioBuffer) {
    const ffmpeg = await ensureFfmpeg(request, runtime);
    request.onProgress({
      phase: "muxing",
      progress: 0,
      detail: "Muxing audio into final MP4 with ffmpeg.wasm...",
    });
    request.onLog?.("export:phase", { phase: "muxing" });
    const videoFileName = "render.mp4";
    const audioFileName = "master.wav";
    const outputFileName = "final.mp4";

    try {
      await ffmpeg.writeFile(videoFileName, new Uint8Array(intermediateBuffer));
      await ffmpeg.writeFile(
        audioFileName,
        encodeAudioBufferAsWav(masterAudioBuffer),
      );

      const exitCode = await ffmpeg.exec([
        "-i",
        videoFileName,
        "-i",
        audioFileName,
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-shortest",
        outputFileName,
      ]);
      if (exitCode !== 0) {
        throw new Error(`ffmpeg.wasm exited with code ${exitCode}.`);
      }

      const muxedData = await ffmpeg.readFile(outputFileName);
      const finalBuffer =
        muxedData instanceof Uint8Array
          ? toArrayBuffer(muxedData)
          : toArrayBuffer(await blobToUint8Array(new Blob([muxedData])));

      const saveMethod = await saveBlob(
        new Blob([finalBuffer], { type: "video/mp4" }),
        request.saveTarget,
      );
      return {
        bytes: finalBuffer.byteLength,
        mimeType: "video/mp4",
        muxedWith: "ffmpeg.wasm",
        saveMethod,
      };
    } finally {
      await Promise.allSettled([
        ffmpeg.deleteFile(videoFileName),
        ffmpeg.deleteFile(audioFileName),
        ffmpeg.deleteFile(outputFileName),
      ]);
    }
  }

  const saveMethod = await saveBlob(
    new Blob([intermediateBuffer], { type: intermediateMimeType }),
    request.saveTarget,
  );
  return {
    bytes: intermediateBuffer.byteLength,
    mimeType: intermediateMimeType,
    muxedWith: "mediabunny",
    saveMethod,
  };
}

export async function destroyWebMediaRuntime() {
  ffmpegRef?.terminate();
  if (ffmpegAssetUrlsRef) {
    URL.revokeObjectURL(ffmpegAssetUrlsRef.coreURL);
    URL.revokeObjectURL(ffmpegAssetUrlsRef.wasmURL);
    ffmpegAssetUrlsRef = null;
  }
  ffmpegRef = null;
  ffmpegLoadRef = null;
}
