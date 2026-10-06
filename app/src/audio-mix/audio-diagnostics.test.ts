import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AudioDiagnostics,
  audioDiagnosticsRequested,
  voiceDiagnostics,
} from "./audio-diagnostics.ts";

function clocked() {
  const clock = { ms: 0 };
  return { clock, diagnostics: new AudioDiagnostics(() => clock.ms) };
}

const context = (state: string) =>
  ({
    state,
    sampleRate: 48_000,
    baseLatency: 0.01,
    outputLatency: 0.02,
  }) as unknown as BaseAudioContext;

describe("audioDiagnosticsRequested", () => {
  it("takes debugAudio=1, and not its absence, 0 or false", () => {
    assert.equal(audioDiagnosticsRequested("?debugAudio=1"), true);
    assert.equal(audioDiagnosticsRequested("?x=2&debugAudio"), true);
    assert.equal(audioDiagnosticsRequested(""), false);
    assert.equal(audioDiagnosticsRequested("?debugAudio=0"), false);
    assert.equal(audioDiagnosticsRequested("?debugAudio=false"), false);
  });
});

describe("AudioDiagnostics", () => {
  it("records nothing until enabled", () => {
    const { diagnostics } = clocked();
    diagnostics.addContext("preview", context("running"));
    diagnostics.recordResync(true);
    diagnostics.recordDrift(0.1);
    const snapshot = diagnostics.snapshot();
    assert.equal(snapshot.contextCount, 0);
    assert.equal(snapshot.resyncs, 0);
    assert.deepEqual(snapshot.drift, []);
  });

  it("counts steady re-syncs and their rate over the last ten seconds", () => {
    const { clock, diagnostics } = clocked();
    diagnostics.enable();
    diagnostics.recordResync(false);
    diagnostics.recordResync(true);
    clock.ms = 15_000;
    diagnostics.recordResync(true);
    diagnostics.recordResync(true);
    clock.ms = 20_000;
    const snapshot = diagnostics.snapshot();
    assert.equal(snapshot.resyncs, 4);
    assert.equal(snapshot.steadyResyncs, 3);
    assert.equal(snapshot.steadyResyncsPerSecond, 0.2);

    diagnostics.reset();
    assert.equal(diagnostics.snapshot().steadyResyncs, 0);
    assert.equal(diagnostics.snapshot().steadyResyncsPerSecond, 0);
  });

  it("keeps the latest drift samples and the open contexts", () => {
    const { diagnostics } = clocked();
    diagnostics.enable();
    for (let sample = 0; sample < 100; sample++) {
      diagnostics.recordDrift(sample / 1000);
    }
    diagnostics.addContext("preview", context("running"));
    diagnostics.addContext("old", context("closed"));
    const snapshot = diagnostics.snapshot();
    assert.equal(snapshot.drift.length, 64);
    assert.equal(snapshot.drift.at(-1), 0.099);
    assert.equal(snapshot.contextCount, 1);
    assert.equal(snapshot.contexts[0].label, "preview");
  });

  it("lists voices until their source is removed, and reports as text", () => {
    const { diagnostics } = clocked();
    diagnostics.enable();
    const remove = diagnostics.addVoices(() => [
      { clipId: "one", kind: "buffer", playbackRate: 1, paused: false },
    ]);
    diagnostics.addContext("preview", context("running"));
    diagnostics.recordResync(true);
    const report = diagnostics.report("TestAgent/1.0");
    assert.match(report, /User agent: TestAgent\/1\.0/);
    assert.match(report, /AudioContexts: 1/);
    assert.match(report, /preview: running, 48000 Hz, base 10\.0 ms/);
    assert.match(report, /one: buffer, rate 1\.000/);
    assert.match(report, /Re-syncs: 1 \(steady playback: 1,/);
    assert.match(report, /Long tasks: not reported by this browser/);
    remove();
    assert.deepEqual(diagnostics.snapshot().voices, []);
  });
});

describe("voiceDiagnostics", () => {
  it("names each voice's kind and rate", () => {
    const element = (playbackRate: number) =>
      ({ playbackRate, paused: false }) as HTMLMediaElement;
    assert.deepEqual(
      voiceDiagnostics(
        new Map([
          [
            "a",
            { player: { element: element(1.5), video: false }, decoded: null },
          ],
          [
            "v",
            { player: { element: element(1), video: true }, decoded: null },
          ],
          ["b", { player: null, decoded: {} }],
        ]),
      ),
      [
        { clipId: "a", kind: "audio", playbackRate: 1.5, paused: false },
        { clipId: "v", kind: "video", playbackRate: 1, paused: false },
        { clipId: "b", kind: "buffer", playbackRate: 1, paused: false },
      ],
    );
  });
});
