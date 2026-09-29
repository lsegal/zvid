import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Selecting a clip only selects it: the playhead and playback origin stay put
// whether playing or stopped. Only entering text editing, or Ctrl/Cmd-clicking
// a clip to jump to it, moves to the clip.
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
    const seeks = [...appTsx.matchAll(/setPlayheadQ\((\w+)\.startQ\)/g)];
    // Only the text-edit entry and the Ctrl/Cmd-click jump (#475) move to a
    // clip.
    assert.equal(seeks.length, 2, seeks.map((match) => match[0]).join(", "));
    for (const marker of [
      "const startTextEdit = useCallback(",
      "const jumpToClipStart = useCallback(",
    ]) {
      assert.match(
        sliceFrom(marker, "\n  );\n"),
        /setPlayheadQ\(\w+\.startQ\)/,
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
