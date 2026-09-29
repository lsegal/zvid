import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Selecting a clip only selects it: the playhead and playback origin stay put
// whether playing or stopped. Only entering text editing moves to the clip.
const appTsx = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

function sliceFrom(marker: string, endMarker: string): string {
  const start = appTsx.indexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  const end = appTsx.indexOf(endMarker, start + marker.length);
  assert.notEqual(end, -1, `missing end of ${marker}`);
  return appTsx.slice(start, end);
}

function assertNoSeek(body: string) {
  assert.doesNotMatch(body, /setPlayheadQ\(/);
  assert.doesNotMatch(body, /playbackOriginRef\.current\s*=/);
}

describe("clip selection keeps the playhead", () => {
  it("clicking an arrangement clip body only selects it", () => {
    const onClick = sliceFrom(
      'className="clip-card__body"\n',
      "onDoubleClick=",
    );
    assert.match(onClick, /setSelectedClipId\(clip\.id\);/);
    assertNoSeek(onClick);
  });

  it("selectSource selects the source's clip without seeking", () => {
    const body = sliceFrom("function selectSource(", "\n  }\n");
    assert.match(body, /setSelectedClipId\(match\.id\);/);
    assertNoSeek(body);
  });

  it("no selection path seeks to a clip's start", () => {
    const seeks = [...appTsx.matchAll(/setPlayheadQ\((\w+)\.startQ\)/g)].map(
      (match) => match.index ?? -1,
    );
    // Only the text-edit entry and a Ctrl/Cmd-click jump (#473) move to a
    // clip; neither is a plain selection.
    const allowed = [
      "const startTextEdit = useCallback(",
      "const jumpToClipStart = useCallback(",
    ].map((marker) => {
      const start = appTsx.indexOf(marker);
      assert.notEqual(start, -1, `missing ${marker}`);
      return { start, end: appTsx.indexOf("\n  );\n", start) };
    });
    assert.equal(seeks.length, allowed.length);
    for (const index of seeks) {
      assert.ok(
        allowed.some(({ start, end }) => index > start && index < end),
        `unexpected seek at ${index}`,
      );
    }
  });

  it("entering text edit on an off-playhead clip still moves to it", () => {
    const textEdit = sliceFrom(
      "const startTextEdit = useCallback(",
      "\n  );\n",
    );
    assert.match(
      textEdit,
      /if \(!isClipAtPlayhead\(clip, playheadQRef\.current, bpm\)\) \{\s*setPlayheadQ\(clip\.startQ\);\s*playbackOriginRef\.current = clip\.startQ;\s*\}/,
    );
  });
});
