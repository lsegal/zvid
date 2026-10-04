import type { RecordingProbe } from "../als-import";
import {
  createMediaId,
  inferMediaKind,
  type MediaItem,
  type Palette,
  probeImageUrl,
  SVG_MIME_TYPE,
  withMediaType,
} from "../media";
import { probeMediaDetails } from "../media-details.ts";
import type { ServerMediaRef } from "../session";
import { probeVideoInput } from "../video-format-probe";
import type { MediaSelection } from "./contracts";
import {
  createFrameThumbnailer,
  type FrameSource,
  type ThumbnailFrameSize,
} from "./frame-thumbnails";

type WebMediaRuntime = {
  mediabunny: typeof import("mediabunny");
};

type MediaAnalysisOptions = {
  id: string;
  name: string;
  previewUrl: string;
  palette: Palette;
  sourcePath?: string;
  // Known for a local file, so its details survive a failed analysis.
  fileSizeBytes?: number;
  lastModified?: number;
};

let runtimePromise: Promise<WebMediaRuntime> | null = null;

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

// Decodes a thumbnail through a detached <video>. Only a fallback for media
// mediabunny cannot decode: Safari blocks the main thread for up to a second
// painting such a video.
function generateThumbnailFromVideoElement(
  url: string,
  timeSeconds: number,
  { width, height }: ThumbnailFrameSize,
) {
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
        // No seek fires here, and at metadata time no frame is decoded yet,
        // so wait for the first frame before drawing it.
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          void handleSeeked();
        } else {
          video.addEventListener("loadeddata", () => void handleSeeked(), {
            once: true,
          });
        }
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

// Opens `url` for frame decoding, or resolves null when it has no video track
// this browser can decode.
async function openFrameSource(url: string): Promise<FrameSource | null> {
  const { ALL_FORMATS, BlobSource, CanvasSink, Input, UrlSource } = (
    await loadRuntime()
  ).mediabunny;
  // Blob URLs cannot serve range requests, and fetching one is cheap.
  const source = url.startsWith("blob:")
    ? new BlobSource(await (await fetch(url)).blob())
    : new UrlSource(url);
  const input = new Input({ formats: ALL_FORMATS, source });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) {
      input.dispose();
      return null;
    }
    const firstTimestamp = await track.getFirstTimestamp();
    const lastTimestamp = Math.max(
      firstTimestamp,
      (await track.computeDuration()) - 0.05,
    );
    const sinks = new Map<string, InstanceType<typeof CanvasSink>>();
    return {
      async frameAt(timeSeconds, { width, height }) {
        const sizeKey = `${width}x${height}`;
        let sink = sinks.get(sizeKey);
        if (!sink) {
          sink = new CanvasSink(track, { width, height, fit: "cover" });
          sinks.set(sizeKey, sink);
        }
        const time = Math.min(
          Math.max(timeSeconds, firstTimestamp),
          lastTimestamp,
        );
        const frame =
          (await sink.getCanvas(time)) ??
          (await sink.getCanvas(firstTimestamp));
        return frame?.canvas ?? null;
      },
      dispose() {
        input.dispose();
      },
    };
  } catch (error) {
    input.dispose();
    throw error;
  }
}

const frameThumbnailer = createFrameThumbnailer({
  open: openFrameSource,
  encode: canvasToObjectUrl,
  fallback: generateThumbnailFromVideoElement,
});

export function generateThumbnailFromUrlAtTime(
  url: string,
  timeSeconds: number,
  options?: {
    width?: number;
    height?: number;
  },
) {
  return frameThumbnailer.generate(url, timeSeconds, {
    width: options?.width ?? 240,
    height: options?.height ?? 420,
  });
}

async function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = import("mediabunny").then((mediabunny) => ({
      mediabunny,
    }));
  }

  return runtimePromise;
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

    const details = await probeMediaDetails(input, durationSeconds);

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
      ...details,
      fileSizeBytes: details.fileSizeBytes ?? options.fileSizeBytes,
      lastModified: options.lastModified,
      color: options.palette.color,
      accent: options.palette.accent,
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
      fileSizeBytes: options.fileSizeBytes,
      lastModified: options.lastModified,
      color: options.palette.color,
      accent: options.palette.accent,
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
    fileSizeBytes: options.fileSizeBytes,
    lastModified: options.lastModified,
    color: options.palette.color,
    accent: options.palette.accent,
    previewUrl: options.previewUrl,
    sourcePath: options.sourcePath,
    availability: "ready",
  };
}

// An image has no tracks for mediabunny to read; its own URL is its
// thumbnail. One that won't load is kept, offline, so the import still shows
// it.
async function analyzeImageMedia(
  options: MediaAnalysisOptions,
): Promise<MediaItem> {
  const size = await probeImageUrl(options.previewUrl).catch(() => undefined);
  return {
    id: options.id,
    name: options.name,
    kind: "image",
    durationSeconds: 0,
    width: size?.width,
    height: size?.height,
    hasAudio: false,
    hasVideo: false,
    fileSizeBytes: options.fileSizeBytes,
    container: "SVG",
    lastModified: options.lastModified,
    color: options.palette.color,
    accent: options.palette.accent,
    previewUrl: options.previewUrl,
    thumbnailUrl: size ? options.previewUrl : undefined,
    sourcePath: options.sourcePath,
    availability: size ? "ready" : "offline",
    ...(size ? {} : { lastError: "Not an image or unsupported format" }),
  };
}

async function analyzeLocalMediaFile(
  file: File,
  palette: Palette,
  runtime: WebMediaRuntime,
) {
  const image =
    file.type === SVG_MIME_TYPE || inferMediaKind(file.name) === "image";
  const previewUrl = URL.createObjectURL(
    image ? withMediaType(file, "image") : file,
  );
  const options: MediaAnalysisOptions = {
    id: createMediaId(file),
    name: file.name,
    previewUrl,
    palette,
    fileSizeBytes: file.size,
    lastModified: file.lastModified,
  };
  if (image) {
    return analyzeImageMedia(options);
  }
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
  if (inferMediaKind(ref.name) === "image") {
    return analyzeImageMedia(options);
  }

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

// Frame count, rate and size of a recording, read from its container metadata.
export async function probeRecordingFrames(
  url: string,
): Promise<RecordingProbe | null> {
  const runtime = await loadRuntime();
  const { ALL_FORMATS, Input, UrlSource } = runtime.mediabunny;
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(url) });
  try {
    return await probeVideoInput(input);
  } finally {
    input.dispose();
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

export async function destroyWebMediaRuntime() {
  runtimePromise = null;
}
