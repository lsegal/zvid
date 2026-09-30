import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  partitionStatusItems,
  STATUS_MESSAGE_TIMEOUT_MS,
  statusMessageClears,
  statusMessageTone,
} from "./status-bar.ts";

const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf8");
const appTsx = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const usePlaybackTs = readFileSync(
  new URL("./hooks/usePlayback.ts", import.meta.url),
  "utf8",
);
const statusBarTsx = readFileSync(
  new URL("./components/StatusBar.tsx", import.meta.url),
  "utf8",
);
const statusPlayheadTsx = readFileSync(
  new URL("./components/StatusPlayhead.tsx", import.meta.url),
  "utf8",
);

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing rule for ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

describe("status bar items", () => {
  it("defaults items to the start group", () => {
    const { start, end } = partitionStatusItems([
      { id: "a", value: "A" },
      { id: "b", value: "B", align: "start" },
    ]);
    assert.deepEqual(
      start.map((item) => item.id),
      ["a", "b"],
    );
    assert.deepEqual(end, []);
  });

  it("keeps the original order within each group", () => {
    const { start, end } = partitionStatusItems([
      { id: "a", value: "A", align: "end" },
      { id: "b", value: "B" },
      { id: "c", value: "C", align: "end" },
      { id: "d", value: "D" },
    ]);
    assert.deepEqual(
      start.map((item) => item.id),
      ["b", "d"],
    );
    assert.deepEqual(
      end.map((item) => item.id),
      ["a", "c"],
    );
  });
});

describe("status bar wiring", () => {
  it("renders the items built from app state", () => {
    assert.match(appTsx, /buildStatusItems\(\{\s*version: ZVID_BUILD,/);
    assert.match(appTsx, /<StatusBar items=\{statusBarItems\}/);
    assert.doesNotMatch(appTsx, /preview-meta/);
  });

  it("keeps the playhead out of the memoized items", () => {
    const start = appTsx.indexOf("const statusBarItems = useMemo");
    assert.notEqual(start, -1, "missing memoized status bar items");
    const block = appTsx.slice(start, appTsx.indexOf("\n  );", start));
    const deps = block.slice(block.lastIndexOf("\n    ["));
    assert.match(block, /<StatusPlayhead/);
    assert.match(deps, /timelineMode,/);
    assert.doesNotMatch(deps, /playheadQ/);
  });

  it("refreshes only the playhead cell during playback", () => {
    assert.match(statusBarTsx, /export const StatusBar = memo\(/);
    assert.match(statusPlayheadTsx, /useSyncExternalStore\(signal\.subscribe/);
    assert.match(usePlaybackTs, /playheadSignal\.set\(nextQ\)/);
  });
});

describe("status bar message", () => {
  it("marks failure reports as errors", () => {
    for (const text of [
      "Open failed: bad header",
      "Export failed: disk full",
      "Dropped media import failed: nope",
      "Public sharing is live, but copying the invite failed: denied",
      "Unable to connect with that invite: expired",
      "Receiving clip.mp4 from peer was interrupted.",
    ]) {
      assert.equal(statusMessageTone(text), "error", text);
    }
  });

  it("treats ordinary progress and confirmations as info", () => {
    for (const text of [
      "Created Layer 3.",
      "Rendering frame 12 of 480...",
      "Open a session or import media to get started.",
      "Saved clip.mp4.",
    ]) {
      assert.equal(statusMessageTone(text), "info", text);
    }
  });

  it("clears info after about eight seconds but keeps errors and sticky messages", () => {
    assert.equal(STATUS_MESSAGE_TIMEOUT_MS, 8000);
    assert.equal(statusMessageClears({ text: "Saved.", tone: "info" }), true);
    assert.equal(
      statusMessageClears({ text: "Export failed: x", tone: "error" }),
      false,
    );
    assert.equal(
      statusMessageClears({
        text: "Encoding video...",
        tone: "info",
        sticky: true,
      }),
      false,
    );
  });

  it("renders in the status bar instead of the transport bar", () => {
    assert.equal(appTsx.includes("transport-summary"), false);
    assert.equal(appCss.includes(".transport-summary"), false);
    assert.match(
      appTsx,
      /<StatusBar items=\{[^}]+\} message=\{statusMessage\} \/>/,
    );
  });

  it("truncates with an ellipsis and colors errors", () => {
    const message = ruleBody(appCss, ".status-bar__message");
    assert.match(message, /text-overflow: ellipsis;/);
    assert.match(message, /white-space: nowrap;/);
    assert.match(message, /flex: 1;/);
    assert.match(
      ruleBody(appCss, ".status-bar__message--error"),
      /color: var\(--pink\);/,
    );
  });
});

describe("status bar layout", () => {
  it("is mounted after the workspace so it docks at the bottom", () => {
    const workspaceEnd = appTsx.lastIndexOf("</main>");
    const statusBar = appTsx.indexOf("<StatusBar ");
    assert.notEqual(statusBar, -1);
    assert.ok(statusBar > workspaceEnd);
  });

  it("keeps a fixed compact height that the shell cannot stretch", () => {
    const bar = ruleBody(appCss, ".status-bar");
    const height = Number(/\bheight: (\d+)px;/.exec(bar)?.[1]);
    assert.ok(height > 0 && height <= 26, `height ${height}px`);
    assert.match(bar, /flex: none;/);
    assert.match(bar, /white-space: nowrap;/);
    assert.match(bar, /overflow: hidden;/);
  });

  it("truncates items with an ellipsis instead of wrapping", () => {
    for (const selector of [".status-bar__item", ".status-bar__value"]) {
      assert.match(ruleBody(appCss, selector), /text-overflow: ellipsis;/);
    }
    assert.match(
      ruleBody(appCss, ".status-bar__item + .status-bar__item"),
      /border-left: 1px solid var\(--line\);/,
    );
  });
});
