import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const appTsx = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const usePlaybackTs = readFileSync(
  new URL("./hooks/usePlayback.ts", import.meta.url),
  "utf8",
);
const playerTsx = readFileSync(
  new URL("./CompositionPlayer.tsx", import.meta.url),
  "utf8",
);

function playbackLoop() {
  const start = usePlaybackTs.indexOf("const step = (timestamp: number) => {");
  assert.notEqual(start, -1, "missing playback loop");
  return usePlaybackTs.slice(start, usePlaybackTs.indexOf("\n    };\n", start));
}

describe("playback rendering", () => {
  it("moves the live playhead every frame without committing state", () => {
    const loop = playbackLoop();
    const frame = loop.slice(loop.lastIndexOf("return;\n      }"));
    assert.match(frame, /playheadSignal\.set\(nextQ\)/);
    assert.doesNotMatch(frame, /\bsetPlayheadQ\(nextQ\)/);
    assert.match(frame, /PLAYBACK_COMMIT_INTERVAL_MS/);
    assert.match(frame, /nextQ >= nextEdgeQ/);
  });

  it("draws per-frame readouts from the playhead signal", () => {
    assert.match(
      appTsx,
      /<TransportPlayheadReadout\s+signal=\{playheadSignal\}/,
    );
    assert.match(
      appTsx,
      /<PlayheadLine\s+className="timeline-playhead"\s+signal=\{playheadSignal\}/,
    );
    assert.match(
      appTsx,
      /<PlayheadLine\s+className="timeline-playhead-marker"\s+signal=\{playheadSignal\}/,
    );
    assert.doesNotMatch(appTsx, /left: labelWidth \+ playheadTimelinePx/);
  });

  it("renders the preview from the live playhead while playing", () => {
    assert.match(appTsx, /playheadSignal=\{playheadSignal\}/);
    assert.match(playerTsx, /const livePlayheadQ = playheadSignal\.get\(\);/);
    assert.match(
      playerTsx,
      /renderer\.renderPreviewFrame\(livePlayheadQ, pixelRatio\)/,
    );
  });
});
