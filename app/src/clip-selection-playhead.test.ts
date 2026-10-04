import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Selecting a clip only selects it: the playhead and playback origin stay put
// whether playing or stopped. Only entering text editing moves to the clip.
const appTsx = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const usePlaybackTs = readFileSync(
  new URL("./hooks/usePlayback.ts", import.meta.url),
  "utf8",
);
const usePreviewEditingTs = readFileSync(
  new URL("./hooks/usePreviewEditing.ts", import.meta.url),
  "utf8",
);
const clipCardTsx = readFileSync(
  new URL("./components/timeline/ClipCard.tsx", import.meta.url),
  "utf8",
);
const useTimelineSelectionTs = readFileSync(
  new URL("./hooks/useTimelineSelection.ts", import.meta.url),
  "utf8",
);
const sourceSpanTsx = readFileSync(
  new URL("./components/timeline/SourceSpan.tsx", import.meta.url),
  "utf8",
);
const source = `${appTsx}
${clipCardTsx}
${useTimelineSelectionTs}
${sourceSpanTsx}
${usePlaybackTs}
${usePreviewEditingTs}`;

function sliceFrom(marker: string, endMarker: string): string {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  const end = source.indexOf(endMarker, start + marker.length);
  assert.notEqual(end, -1, `missing end of ${marker}`);
  return source.slice(start, end);
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

  it("selecting a source track or clip doesn't seek", () => {
    const body = sliceFrom("const selectSource = useCallback(", "\n  );\n");
    assert.match(body, /setSourceSelection\(selection\);/);
    assertNoSeek(body);
    const onClick = sliceFrom("onClick={(event) => {", "onContextMenu=");
    assert.match(onClick, /selectSourceSpan\(clip\);/);
    assertNoSeek(onClick);
  });

  it("no selection path seeks to a clip's start", () => {
    const seeks = [
      ...source.matchAll(/(?:setPlayheadQ|jumpPlayheadTo)\((\w+)\.startQ\)/g),
    ];
    // Only the text-edit entry and the explicit Ctrl/Cmd-click jump move to
    // a clip.
    assert.equal(seeks.length, 2, seeks.map((match) => match[0]).join(", "));
    const textEdit = sliceFrom(
      "const startTextEdit = useCallback(",
      "\n  );\n",
    );
    const jump = sliceFrom("const jumpToClipStart = useCallback(", "\n  );\n");
    const seekIndexes = seeks.map((match) => match.index);
    for (const body of [textEdit, jump]) {
      const start = source.indexOf(body);
      assert.ok(
        seekIndexes.some(
          (index) => index >= start && index < start + body.length,
        ),
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
