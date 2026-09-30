import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  hasArrangementActivity,
  isArrangementEmptyStateDismissedOnOpen,
  shouldShowArrangementEmptyState,
} from "./arrangement-empty-state.ts";

const appTsx = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const useArrangementEmptyStateTs = readFileSync(
  new URL("./hooks/useArrangementEmptyState.ts", import.meta.url),
  "utf8",
);
const sessionIOTs = readFileSync(
  new URL("./hooks/useSessionIO.ts", import.meta.url),
  "utf8",
);
const componentTsx = readFileSync(
  new URL("./components/ArrangementEmptyState.tsx", import.meta.url),
  "utf8",
);
const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf8");

const noActivity = {
  clipCount: 0,
  hasClipSelection: false,
  hasPendingSelection: false,
};

describe("arrangement empty state visibility", () => {
  it("is shown for an empty arrangement with sources", () => {
    assert.equal(
      shouldShowArrangementEmptyState({
        clipCount: 0,
        sourceSpanCount: 3,
        dismissed: false,
      }),
      true,
    );
  });

  it("is hidden without sources", () => {
    assert.equal(
      shouldShowArrangementEmptyState({
        clipCount: 0,
        sourceSpanCount: 0,
        dismissed: false,
      }),
      false,
    );
  });

  it("is hidden once the arrangement has clips", () => {
    assert.equal(
      shouldShowArrangementEmptyState({
        clipCount: 1,
        sourceSpanCount: 3,
        dismissed: false,
      }),
      false,
    );
  });

  it("is hidden once dismissed, even with the arrangement empty again", () => {
    assert.equal(
      shouldShowArrangementEmptyState({
        clipCount: 0,
        sourceSpanCount: 3,
        dismissed: true,
      }),
      false,
    );
  });
});

describe("arrangement empty state dismissal", () => {
  it("does not dismiss without any clip or selection", () => {
    assert.equal(hasArrangementActivity(noActivity), false);
  });

  it("dismisses when a clip is created", () => {
    assert.equal(hasArrangementActivity({ ...noActivity, clipCount: 1 }), true);
  });

  it("dismisses when a clip is selected", () => {
    assert.equal(
      hasArrangementActivity({ ...noActivity, hasClipSelection: true }),
      true,
    );
  });

  it("dismisses when a span is selected on the timeline", () => {
    assert.equal(
      hasArrangementActivity({ ...noActivity, hasPendingSelection: true }),
      true,
    );
  });

  it("comes back when a session opens with an empty arrangement", () => {
    assert.equal(isArrangementEmptyStateDismissedOnOpen(0), false);
    assert.equal(isArrangementEmptyStateDismissedOnOpen(4), true);
  });
});

describe("arrangement empty state wiring", () => {
  it("runs the arrangement wand when the button is clicked", () => {
    assert.match(
      appTsx,
      /<ArrangementEmptyState[\s\S]*?onGenerate=\{handleRandomizeTimeline\}/,
    );
  });

  it("hides for the session when dismissed", () => {
    assert.match(
      appTsx,
      /<ArrangementEmptyState[\s\S]*?onDismiss=\{\(\) =>\s*setArrangementEmptyStateDismissed\(true\)\s*\}/,
    );
  });

  it("dismisses on clip creation or selection and resets on session open", () => {
    assert.match(
      useArrangementEmptyStateTs,
      /hasArrangementActivity\(\{\s*clipCount: clips\.length,\s*hasClipSelection: selectedClipId !== undefined,\s*hasPendingSelection: pendingSelection !== null,/,
    );
    assert.match(
      sessionIOTs,
      /async function applyOpenedSessionPayload[\s\S]*?setArrangementEmptyStateDismissed\(\s*isArrangementEmptyStateDismissedOnOpen\(project\.arrangementClips\.length\)/,
    );
  });

  it("labels the generate and dismiss buttons", () => {
    assert.match(componentTsx, /Generate a sweet timeline/);
    assert.match(componentTsx, /<WandIcon \/>/);
    assert.match(componentTsx, /aria-label="Dismiss"/);
  });

  it('dismisses from a single bordered "✕ or dismiss" button', () => {
    const dismiss = componentTsx.match(
      /<button\s[^>]*aria-label="Dismiss"[^>]*>[\s\S]*?<\/button>/,
    )?.[0];
    assert.ok(dismiss, "expected a button named Dismiss");
    assert.match(dismiss, /type="button"/);
    assert.match(dismiss, /onClick=\{onDismiss\}/);
    assert.match(dismiss, /<span aria-hidden="true">✕<\/span>/);
    assert.match(dismiss, /<span>or dismiss<\/span>/);
    assert.equal(componentTsx.match(/aria-label="Dismiss"/g)?.length, 1);

    const rule = [
      ...appCss.matchAll(/\n\.arrangement-empty-state__dismiss \{([^}]*)\}/g),
    ]
      .map((match) => match[1])
      .join("");
    assert.match(rule, /background: transparent;/);
    assert.match(rule, /border: 1px solid var\(--line-strong\);/);
    assert.match(rule, /border-radius: 999px;/);
    assert.match(rule, /color: var\(--muted\);/);
    assert.match(
      appCss,
      /\.arrangement-empty-state__dismiss:focus-visible \{[^}]*border-color: #ffe084;/,
    );
  });

  it("lets pointer events through to the lanes except on its buttons", () => {
    assert.match(
      appCss,
      /\.arrangement-empty-state \{[^}]*pointer-events: none;/,
    );
    assert.match(
      appCss,
      /\.arrangement-empty-state__generate,\s*\.arrangement-empty-state__dismiss \{[^}]*pointer-events: auto;/,
    );
  });
});
