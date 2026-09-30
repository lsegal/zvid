import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const appTsx = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const timelineToolbarTsx = readFileSync(
  new URL("./components/timeline/TimelineToolbar.tsx", import.meta.url),
  "utf8",
);
const timelineTsx = readFileSync(
  new URL("./components/timeline/Timeline.tsx", import.meta.url),
  "utf8",
);
const rulerTsx = readFileSync(
  new URL("./components/timeline/Ruler.tsx", import.meta.url),
  "utf8",
);
const timelineSource = `${appTsx}
${timelineToolbarTsx}
${timelineTsx}
${rulerTsx}`;
const usePlaybackTs = readFileSync(
  new URL("./hooks/usePlayback.ts", import.meta.url),
  "utf8",
);
const playerTsx = readFileSync(
  new URL("./CompositionPlayer.tsx", import.meta.url),
  "utf8",
);
const livePlayheadTsx = readFileSync(
  new URL("./components/LivePlayhead.tsx", import.meta.url),
  "utf8",
);
const timelineCss = (name: string) =>
  readFileSync(
    new URL(`./components/timeline/${name}.css`, import.meta.url),
    "utf8",
  );
const cssRule = (css: string, className: string) =>
  css.match(new RegExp(`(^|\\n)\\.${className} \\{[^}]*\\}`))?.[0] ?? "";

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
      timelineToolbarTsx,
      /<TransportPlayheadReadout\s+signal=\{playheadSignal\}/,
    );
    assert.match(
      timelineTsx,
      /<PlayheadLine\s+className="timeline-playhead"\s+signal=\{playheadSignal\}/,
    );
    assert.match(
      rulerTsx,
      /<PlayheadLine\s+className="timeline-playhead-marker"\s+signal=\{playheadSignal\}/,
    );
    assert.doesNotMatch(
      timelineSource,
      /left: labelWidth \+ playheadTimelinePx/,
    );
  });

  it("renders the preview from the live playhead while playing", () => {
    assert.match(appTsx, /playheadSignal=\{playheadSignal\}/);
    assert.match(playerTsx, /const livePlayheadQ = playheadSignal\.get\(\);/);
    assert.match(
      playerTsx,
      /renderer\.renderPreviewFrame\(livePlayheadQ, pixelRatio\)/,
    );
  });

  // WebKit repaints on the main thread whatever a moving playhead dirties,
  // which held Safari playback to about 30 fps (#620).
  it("moves the playhead lines without repainting the timeline", () => {
    const line = livePlayheadTsx.slice(
      livePlayheadTsx.indexOf("export function PlayheadLine"),
      livePlayheadTsx.indexOf("export function TransportPlayheadReadout"),
    );
    assert.match(line, /transform: `translateX\(\$\{left\}px\)/);
    assert.doesNotMatch(line, /style=\{\{ left \}\}/);
    for (const [sheet, className] of [
      ["timeline", "timeline-playhead"],
      ["ruler", "timeline-playhead-marker"],
    ]) {
      const rule = cssRule(timelineCss(sheet), className);
      assert.match(rule, /will-change: transform;/, className);
      assert.doesNotMatch(rule, /\btransform: translate/, className);
    }
  });

  it("keeps backdrop blur off the ruler that holds the playhead marker", () => {
    const rule = cssRule(timelineCss("ruler"), "ruler-row");
    assert.notEqual(rule, "");
    assert.doesNotMatch(rule, /^\s*backdrop-filter:/m);
  });
});
