// What a track being recorded has captured so far, for its growing clip:
// small frames from its camera for the filmstrip and loudness peaks from
// its microphone for the waveform.
import { analysisAudioContext } from "./shared-audio-context.ts";

// How often a filmstrip frame is grabbed, and how tall it is, in pixels.
const FRAME_INTERVAL_SECONDS = 1;
const FRAME_HEIGHT_PX = 56;
// How often the waveform takes a peak, in seconds.
const PEAK_INTERVAL_SECONDS = 0.05;

// A small frame of the camera and when it was grabbed. Frames are kept as
// bitmaps, so nothing is encoded on the main thread.
export type LiveFrame = { atSeconds: number; image: CanvasImageSource };

/** The frame showing `atSeconds`: the last one grabbed at or before it. */
export function liveFrameAt(frames: readonly LiveFrame[], atSeconds: number) {
  let low = 0;
  let high = frames.length - 1;
  let found: LiveFrame | undefined;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const frame = frames[middle];
    if (frame && frame.atSeconds <= atSeconds) {
      found = frame;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found ?? frames[0];
}

/** One peak per `PEAK_INTERVAL_SECONDS`, from 0 to 1. */
export const LIVE_PEAK_INTERVAL_SECONDS = PEAK_INTERVAL_SECONDS;

// The parts of ImageCapture a monitor uses; Chromium has it.
type ImageCaptureLike = { grabFrame(): Promise<ImageBitmap> };
type ImageCaptureConstructor = new (track: MediaStreamTrack) => ImageCaptureLike;

// Scales `source` down to a filmstrip frame.
async function shrinkFrame(
  source: ImageBitmap | HTMLVideoElement,
  width: number,
  height: number,
): Promise<CanvasImageSource | null> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(source, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: "low",
    });
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

export class LiveTakeMonitor {
  readonly frames: LiveFrame[] = [];
  readonly peaks: number[] = [];
  // The frame aspect ratio, width over height, once the camera reports it.
  aspect = 16 / 9;
  private readonly elapsedSeconds: () => number;
  private imageCapture: ImageCaptureLike | null = null;
  private video: HTMLVideoElement | null = null;
  private videoFrameCallback = 0;
  private grabbing = false;
  private disposed = false;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Float32Array<ArrayBuffer> | null = null;
  private timers: number[] = [];

  constructor(stream: MediaStream, elapsedSeconds: () => number) {
    this.elapsedSeconds = elapsedSeconds;
    const [videoTrack] = stream.getVideoTracks();
    if (videoTrack) {
      this.watchVideo(videoTrack);
    }
    if (stream.getAudioTracks().length) {
      this.watchAudio(stream);
    }
  }

  // Frames come straight off the camera track where the browser can grab
  // them; elsewhere from a muted video, once per new frame it shows.
  private watchVideo(track: MediaStreamTrack) {
    const ImageCapture = (
      globalThis as { ImageCapture?: ImageCaptureConstructor }
    ).ImageCapture;
    if (ImageCapture) {
      try {
        this.imageCapture = new ImageCapture(track);
        void this.grabFrame();
        this.timers.push(
          window.setInterval(
            () => void this.grabFrame(),
            FRAME_INTERVAL_SECONDS * 1000,
          ),
        );
        return;
      } catch {
        this.imageCapture = null;
      }
    }
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    void video.play().catch(() => {});
    this.video = video;
    if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
      const onFrame = () => {
        if (this.disposed) return;
        if (this.frameDue()) void this.grabFrame();
        this.videoFrameCallback = video.requestVideoFrameCallback(onFrame);
      };
      this.videoFrameCallback = video.requestVideoFrameCallback(onFrame);
    } else {
      video.onloadeddata = () => void this.grabFrame();
      this.timers.push(
        window.setInterval(
          () => void this.grabFrame(),
          FRAME_INTERVAL_SECONDS * 1000,
        ),
      );
    }
  }

  // The first frame, then one a second.
  private frameDue() {
    const last = this.frames.at(-1);
    return (
      !last || this.elapsedSeconds() - last.atSeconds >= FRAME_INTERVAL_SECONDS
    );
  }

  private async grabFrame() {
    if (this.grabbing || this.disposed) return;
    this.grabbing = true;
    const atSeconds = this.elapsedSeconds();
    try {
      let source: ImageBitmap | HTMLVideoElement | null = null;
      let width = 0;
      let height = 0;
      if (this.imageCapture) {
        const bitmap = await this.imageCapture.grabFrame();
        source = bitmap;
        width = bitmap.width;
        height = bitmap.height;
      } else if (this.video?.videoWidth && this.video.videoHeight) {
        source = this.video;
        width = this.video.videoWidth;
        height = this.video.videoHeight;
      }
      if (!source || !width || !height) return;
      this.aspect = width / height;
      const image = await shrinkFrame(
        source,
        Math.max(1, Math.round(FRAME_HEIGHT_PX * this.aspect)),
        FRAME_HEIGHT_PX,
      );
      if (source !== this.video) (source as ImageBitmap).close();
      if (!image) return;
      if (this.disposed) {
        closeFrame(image);
        return;
      }
      this.frames.push({ atSeconds, image });
    } catch {
      // The camera had no frame yet; the next grab tries again.
    } finally {
      this.grabbing = false;
    }
  }

  private watchAudio(stream: MediaStream) {
    try {
      const audioContext = analysisAudioContext.acquire();
      try {
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        this.source = source;
        this.analyser = analyser;
      } catch (error) {
        analysisAudioContext.release();
        throw error;
      }
      this.samples = new Float32Array(this.analyser.fftSize);
      this.timers.push(
        window.setInterval(() => this.takePeak(), PEAK_INTERVAL_SECONDS * 1000),
      );
    } catch {
      // Without Web Audio the clip just shows no waveform while recording.
    }
  }
  private takePeak() {
    const analyser = this.analyser;
    const samples = this.samples;
    if (!analyser || !samples) return;
    analyser.getFloatTimeDomainData(samples);
    let peak = 0;
    for (const sample of samples) {
      peak = Math.max(peak, Math.min(1, Math.abs(sample)));
    }
    // Fill any gap a throttled timer left, so peaks keep pace with time.
    const index = Math.floor(this.elapsedSeconds() / PEAK_INTERVAL_SECONDS);
    while (this.peaks.length < index) {
      this.peaks.push(peak);
    }
    this.peaks.push(peak);
  }

  dispose() {
    this.disposed = true;
    for (const timer of this.timers) {
      window.clearInterval(timer);
    }
    this.timers = [];
    this.imageCapture = null;
    if (this.video) {
      if (this.videoFrameCallback) {
        this.video.cancelVideoFrameCallback(this.videoFrameCallback);
      }
      this.video.onloadeddata = null;
      this.video.srcObject = null;
      this.video = null;
    }
    for (const frame of this.frames) closeFrame(frame.image);
    if (this.source) {
      this.source.disconnect();
      this.source = null;
      analysisAudioContext.release();
    }
    this.analyser = null;
  }
}

function closeFrame(image: CanvasImageSource) {
  if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
    image.close();
  }
}
