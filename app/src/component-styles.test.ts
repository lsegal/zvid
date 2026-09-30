import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const appCss = read("./App.css");

// Components extracted from App.tsx keep their rules next to them.
const componentStyles = [
  {
    component: "TopBar",
    stylesheet: "top-bar",
    selectors: [
      ".topbar",
      ".file-menu-button",
      ".collaboration-status",
      ".share-button",
      ".share-copy-badge",
    ],
  },
  {
    component: "PreviewPanel",
    stylesheet: "preview-panel",
    selectors: [
      ".preview-panel",
      ".preview-monitor",
      ".preview-placeholder",
      ".preview-resize-handle",
    ],
  },
  {
    component: "FxPanel",
    stylesheet: "fx-panel",
    selectors: [".fx-panel__toggle", ".fx-panel__body"],
  },
  {
    component: "AppDialogs",
    stylesheet: "app-dialogs",
    selectors: [
      ".share-dialog__body",
      ".connect-dialog__input",
      ".collaboration-diagnostics",
      ".workspace-lock-banner",
    ],
  },
  {
    component: "ArrangementEmptyState",
    stylesheet: "arrangement-empty-state",
    selectors: [".arrangement-empty-state"],
  },
  {
    component: "SourceEmptyState",
    stylesheet: "source-empty-state",
    selectors: [".source-empty-state"],
  },
  {
    component: "timeline/Timeline",
    stylesheet: "timeline/timeline",
    selectors: [
      ".timeline-scroll",
      ".timeline-canvas",
      ".timeline-playhead",
      ".label-resize-handle",
      ".playhead-jump",
    ],
  },
  {
    component: "timeline/TimelineToolbar",
    stylesheet: "timeline/timeline-toolbar",
    selectors: [
      ".timeline-toolbar__display",
      ".status-light",
      ".layer-toolbar",
    ],
  },
  {
    component: "timeline/TransportBar",
    stylesheet: "timeline/transport-bar",
    selectors: [".zoom-control", ".transport-cluster"],
  },
  {
    component: "timeline/Ruler",
    stylesheet: "timeline/ruler",
    selectors: [
      ".ruler-marker",
      ".timeline-playhead-marker",
      ".track-label__offline",
    ],
  },
  {
    component: "timeline/LayerHeader",
    stylesheet: "timeline/layer-header",
    selectors: [
      ".track-label--lane",
      ".track-label__rename",
      ".track-label__grip",
    ],
  },
  {
    component: "timeline/ArrangementLanes",
    stylesheet: "timeline/arrangement-lanes",
    selectors: [
      ".arrangement-lanes",
      ".track-row--lifted",
      ".layer-drop-indicator",
    ],
  },
  {
    component: "timeline/LaneRow",
    stylesheet: "timeline/lane-row",
    selectors: [".track-row__content--arrangement"],
  },
  {
    component: "timeline/ClipCard",
    stylesheet: "timeline/clip-card",
    selectors: [".clip-card"],
  },
  {
    component: "timeline/SelectionOverlay",
    stylesheet: "timeline/selection-overlay",
    selectors: [".timeline-selection"],
  },
  {
    component: "timeline/MainAudioRow",
    stylesheet: "timeline/main-audio-row",
    selectors: [".track-label__audio", ".track-row--bus", ".waveform__empty"],
  },
  {
    component: "timeline/SourceTracks",
    stylesheet: "timeline/source-tracks",
    selectors: [
      ".source-header__toggle",
      ".track-label--source",
      ".source-drop-preview",
    ],
  },
  {
    component: "timeline/SourceSpan",
    stylesheet: "timeline/source-span",
    selectors: [".source-span"],
  },
];

describe("component stylesheets", () => {
  for (const { component, stylesheet, selectors } of componentStyles) {
    it(`${component} imports and owns ${stylesheet}.css`, () => {
      const tsx = read(`./components/${component}.tsx`);
      const css = read(`./components/${stylesheet}.css`);
      const file = stylesheet.split("/").pop();
      assert.match(tsx, new RegExp(`import "\\./${file}\\.css";`));
      for (const selector of selectors) {
        const rule = new RegExp(`^\\s*\\${selector}[\\s.:{_-]`, "m");
        assert.match(css, rule, selector);
        assert.doesNotMatch(appCss, rule, selector);
      }
    });
  }

  it("keeps the panel chrome shared by the editor and FX panels in App.css", () => {
    assert.match(appCss, /\.editor-panel,\n\.fx-panel \{/);
  });

  it("keeps the rules timeline components share with each other in App.css", () => {
    assert.match(appCss, /\n\.ruler-row,\n\.track-row,\n\.source-header \{/);
    assert.match(appCss, /\n\.timeline-toolbar,\n\.transport-bar \{/);
    assert.match(appCss, /\n\.track-label \{/);
    assert.match(appCss, /\n\.track-label__fx \{/);
    assert.match(appCss, /\n\.track-row__content \{/);
  });

  it("keeps the rules timeline components share with dialogs in App.css", () => {
    assert.match(appCss, /\n\.segmented-control \{/);
    assert.match(appCss, /\n\.transport-button \{/);
  });
});
