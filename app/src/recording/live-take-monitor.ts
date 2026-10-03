// What a track being recorded has captured so far, for its growing clip:
// small frames from its camera for the filmstrip and loudness peaks from
// its microphone for the waveform.

// How often a filmstrip frame is grabbed, and how tall it is, in pixels.
const FRAME_INTERVAL_SECONDS = 1;
const FRAME_HEIGHT_PX = 56;
// How often the waveform takes a peak, in seconds.
const PEAK_INTERVAL_SECONDS = 0.05;

export type LiveFrame = { atSeconds: number; url: string };

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

export class LiveTakeMonitor {
  readonly frames: LiveFrame[] = [];
  readonly peaks: number[] = [];
  // The frame aspect ratio, width over height, once the camera reports it.
  aspect = 16 / 9;
  private readonly elapsedSeconds: () => number;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Float32Array<ArrayBuffer> | null = null;
  private timers: number[] = [];

  constructor(stream: MediaStream, elapsedSeconds: () => number) {
    this.elapsedSeconds = elapsedSeconds;
    if (stream.getVideoTracks().length) {
      this.watchVideo(stream);
    }
    if (stream.getAudioTracks().length) {
      this.watchAudio(stream);
    }
  }

  private watchVideo(stream: MediaStream) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream(stream.getVideoTracks());
    void video.play().catch(() => {});
    this.video = video;
    this.canvas = document.createElement("canvas");
    this.grabFrame();
    this.timers.push(
      window.setInterval(() => this.grabFrame(), FRAME_INTERVAL_SECONDS * 1000),
    );
  }

  private grabFrame() {
    const video = this.video;
    const canvas = this.canvas;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      // The first frame is grabbed as soon as the camera has one.
      if (video && !this.frames.length) {
        video.onloadeddata = () => this.grabFrame();
      }
      return;
    }
    this.aspect = video.videoWidth / video.videoHeight;
    canvas.height = FRAME_HEIGHT_PX;
    canvas.width = Math.round(FRAME_HEIGHT_PX * this.aspect);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    this.frames.push({
      atSeconds: this.elapsedSeconds(),
      url: canvas.toDataURL("image/jpeg", 0.6),
    });
  }

  private watchAudio(stream: MediaStream) {
    try {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      this.audioContext = audioContext;
      this.analyser = analyser;
      this.samples = new Float32Array(analyser.fftSize);
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
    for (const timer of this.timers) {
      window.clearInterval(timer);
    }
    this.timers = [];
    if (this.video) {
      this.video.onloadeddata = null;
      this.video.srcObject = null;
      this.video = null;
    }
    void this.audioContext?.close().catch(() => {});
    this.audioContext = null;
    this.analyser = null;
  }
}
