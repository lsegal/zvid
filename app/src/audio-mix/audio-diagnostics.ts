// Preview audio diagnostics a remote tester can copy (#1111): with
// `?debugAudio=1` in the page URL, the preview records its AudioContexts,
// voices, re-syncs and drift, and the main thread's long tasks, and
// AudioDiagnosticsPanel shows them as a report to paste into an issue.
// Without the flag nothing is recorded.

export type AudioVoiceDiagnostics = {
  clipId: string;
  // A media element (<audio> or <video>) or a decoded buffer.
  kind: "audio" | "video" | "buffer";
  playbackRate: number;
  paused: boolean;
};

// The diagnostics of a mixer's voices, by clip id.
export function voiceDiagnostics(
  voices: ReadonlyMap<
    string,
    {
      player: { element: HTMLMediaElement; video: boolean } | null;
      decoded: unknown;
    }
  >,
): AudioVoiceDiagnostics[] {
  return [...voices].map(([clipId, { player }]) => ({
    clipId,
    kind: player ? (player.video ? "video" : "audio") : "buffer",
    playbackRate: player?.element.playbackRate ?? 1,
    paused: player?.element.paused ?? false,
  }));
}

// A re-sync: an element seeked, or a buffer restarted, to meet the
// playhead.
type Resync = { atMs: number; steady: boolean };

const MAX_DRIFT_SAMPLES = 64;
const MAX_RESYNCS = 512;
// The window the steady re-sync rate is measured over.
const RATE_WINDOW_MS = 10_000;

export function audioDiagnosticsRequested(search: string) {
  const value = new URLSearchParams(search).get("debugAudio");
  return value !== null && value !== "0" && value !== "false";
}

export class AudioDiagnostics {
  enabled = false;
  private contexts: { label: string; context: BaseAudioContext }[] = [];
  private voiceSources = new Set<() => AudioVoiceDiagnostics[]>();
  private resyncs: Resync[] = [];
  private steadyResyncCount = 0;
  private drift: number[] = [];
  private longTaskCount = 0;
  private longTasksObserved = false;
  private sinceMs = 0;
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  // Starts recording, observing long tasks where the browser reports them.
  enable() {
    if (this.enabled) {
      return;
    }
    this.enabled = true;
    this.sinceMs = this.now();
    if (
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes?.includes("longtask")
    ) {
      new PerformanceObserver((list) => {
        this.longTaskCount += list.getEntries().length;
      }).observe({ type: "longtask", buffered: false });
      this.longTasksObserved = true;
    }
  }

  addContext(label: string, context: BaseAudioContext) {
    if (this.enabled) {
      this.contexts.push({ label, context });
    }
  }

  // Lists a mixer's voices in the report until the returned function is
  // called.
  addVoices(source: () => AudioVoiceDiagnostics[]) {
    this.voiceSources.add(source);
    return () => {
      this.voiceSources.delete(source);
    };
  }

  // A seek or restart to meet the playhead; `steady` during plain playback.
  recordResync(steady: boolean) {
    if (!this.enabled) {
      return;
    }
    this.resyncs.push({ atMs: this.now(), steady });
    if (this.resyncs.length > MAX_RESYNCS) {
      this.resyncs.shift();
    }
    if (steady) {
      this.steadyResyncCount += 1;
    }
  }

  // How far, in seconds, an element playing steadily was from the
  // playhead: positive ahead.
  recordDrift(seconds: number) {
    if (!this.enabled) {
      return;
    }
    this.drift.push(seconds);
    if (this.drift.length > MAX_DRIFT_SAMPLES) {
      this.drift.shift();
    }
  }

  // Clears the counters, as a test does once playback has started.
  reset() {
    this.resyncs = [];
    this.steadyResyncCount = 0;
    this.drift = [];
    this.longTaskCount = 0;
    this.sinceMs = this.now();
  }

  snapshot() {
    const nowMs = this.now();
    const windowStart = Math.max(this.sinceMs, nowMs - RATE_WINDOW_MS);
    const recent = this.resyncs.filter(
      (resync) => resync.steady && resync.atMs >= windowStart,
    ).length;
    const windowSeconds = Math.max(0.001, (nowMs - windowStart) / 1000);
    const live = this.contexts.filter(
      ({ context }) => context.state !== "closed",
    );
    return {
      contextCount: live.length,
      contexts: live.map(({ label, context }) => ({
        label,
        state: context.state,
        sampleRate: context.sampleRate,
        baseLatency: (context as AudioContext).baseLatency,
        outputLatency: (context as AudioContext).outputLatency,
      })),
      voices: [...this.voiceSources].flatMap((source) => source()),
      resyncs: this.resyncs.length,
      steadyResyncs: this.steadyResyncCount,
      steadyResyncsPerSecond: recent / windowSeconds,
      drift: [...this.drift],
      longTasks: this.longTasksObserved ? this.longTaskCount : null,
      seconds: (nowMs - this.sinceMs) / 1000,
    };
  }

  // The snapshot as text to paste into an issue.
  report(userAgent = globalThis.navigator?.userAgent ?? "unknown") {
    const snapshot = this.snapshot();
    const ms = (seconds: number | undefined) =>
      seconds === undefined ? "n/a" : `${(seconds * 1000).toFixed(1)} ms`;
    const lines = [
      "zvid preview audio diagnostics",
      `User agent: ${userAgent}`,
      `Recorded for: ${snapshot.seconds.toFixed(1)} s`,
      `AudioContexts: ${snapshot.contextCount}`,
      ...snapshot.contexts.map(
        (context) =>
          `  ${context.label}: ${context.state}, ${context.sampleRate} Hz, base ${ms(context.baseLatency)}, output ${ms(context.outputLatency)}`,
      ),
      `Voices: ${snapshot.voices.length}`,
      ...snapshot.voices.map(
        (voice) =>
          `  ${voice.clipId}: ${voice.kind}, rate ${voice.playbackRate.toFixed(3)}${voice.paused ? ", paused" : ""}`,
      ),
      `Re-syncs: ${snapshot.resyncs} (steady playback: ${snapshot.steadyResyncs}, ${snapshot.steadyResyncsPerSecond.toFixed(2)}/s over the last 10 s)`,
      `Drift (ms, latest last): ${
        snapshot.drift.length
          ? snapshot.drift
              .map((seconds) => (seconds * 1000).toFixed(0))
              .join(" ")
          : "none"
      }`,
      `Long tasks: ${snapshot.longTasks ?? "not reported by this browser"}`,
    ];
    return lines.join("\n");
  }
}

// The app's diagnostics, enabled by `?debugAudio=1`.
export const audioDiagnostics = new AudioDiagnostics();
if (
  typeof location !== "undefined" &&
  audioDiagnosticsRequested(location.search)
) {
  audioDiagnostics.enable();
  (
    globalThis as { zvidAudioDiagnostics?: AudioDiagnostics }
  ).zvidAudioDiagnostics = audioDiagnostics;
}
