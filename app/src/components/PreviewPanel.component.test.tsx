import { createRef } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "vitest-browser-react";
import { PREVIEW_DEFAULT_WIDTH, PREVIEW_MIN_WIDTH } from "../app/constants.ts";
import { SILENT_AUDIO_MIX } from "../audio-mix/resolve.ts";
import type { CompositionPlayerHandle } from "../CompositionPlayer";
import { IDENTITY_TRANSFORM } from "../composition-transform.ts";
import { DesktopShell } from "../component-test/shells.tsx";
import { setViewport } from "../component-test/viewport.ts";
import { createPlayheadSignal } from "../playhead-signal.ts";
import { PreviewPanel, type PreviewPanelProps } from "./PreviewPanel";

// The preview panel in the editor grid, at the width the app gives it, with
// an empty session: no clip at the playhead. Ported from
// e2e/preview-header-padding.spec.ts and e2e/preview-canvas-size.spec.ts.
const noop = () => {};

function previewPanelProps(width: number): PreviewPanelProps {
  return {
    activatePreviewLayer: noop,
    audioMix: SILENT_AUDIO_MIX,
    bpm: 120,
    canvasHeight: 1080,
    canvasWidth: 1920,
    commitPreviewWidth: noop,
    compositionPlayerRef: createRef<CompositionPlayerHandle>(),
    effectivePreviewWidth: width,
    fps: 30,
    getPreviewLayerPosition: () => ({ x: 0, y: 0 }),
    getPreviewLayerTransform: () => IDENTITY_TRANSFORM,
    handlePreviewResizeKeyDown: noop,
    handlePreviewResizePointerDown: noop,
    handlePreviewResizePointerEnd: noop,
    handlePreviewResizePointerMove: noop,
    hasOnlinePlayheadClip: false,
    isPlaying: false,
    isTimelineAudibleScrubbing: false,
    mediaItems: [],
    mediaPreview: {
      previewTab: "timeline",
      selectPreviewTab: noop,
      previewMediaItem: undefined,
      isMediaPlaying: false,
      setMediaPlaying: noop,
      toggleMediaPlayback: noop,
      loadPreviewMedia: noop,
    },
    mediaRange: { setPoint: noop, clear: noop },
    mediaTimeFormat: {
      timelineMode: "bars",
      bpm: 120,
      signature: { numerator: 4, denominator: 4 },
      fps: 30,
    },
    movePreviewLayer: noop,
    playheadSignal: createPlayheadSignal(),
    previewClip: undefined,
    previewLaneId: undefined,
    previewLayers: [],
    previewMaxWidth: 1000,
    previewMediaState: "online",
    previewTextEdit: undefined,
    previewVolume: { volume: 1, muted: false },
    projectDurationFrames: undefined,
    renderClips: [],
    renderEffects: [],
    renderFromSourceTracks: false,
    renderLanes: [],
    resolvePreviewLayersAt: () => [],
    selectedClip: undefined,
    selectPreviewLayer: noop,
    textEdit: null,
    timelineDragState: null,
    transformPreviewLayer: noop,
  };
}

// The editor grid as App lays it out: the media drawer and timeline columns,
// then the panel's resize handle and the panel at `--preview-width`.
function editorGrid(width: number) {
  return (
    <DesktopShell>
      <div
        className="editor-grid"
        style={{
          flex: 1,
          ["--preview-width" as string]: `${width}px`,
        }}
      >
        <div />
        <div />
        <PreviewPanel {...previewPanelProps(width)} />
      </div>
    </DesktopShell>
  );
}

describe("header", () => {
  const HEADER_MIN_HEIGHT = 34;
  const HEADER_INSET = 6;
  const ITEM_GAP = 12;

  // Header geometry, measured against the strip's padding box (inside its
  // border).
  function headerLayout() {
    const header = document.querySelector<HTMLElement>(
      ".preview-panel__header",
    );
    if (!header) {
      throw new Error("preview header is missing");
    }
    const box = header.getBoundingClientRect();
    const style = getComputedStyle(header);
    const innerLeft = box.left + Number.parseFloat(style.borderLeftWidth);
    const innerRight = box.right - Number.parseFloat(style.borderRightWidth);
    const items = [...header.children].map((child) => {
      const rect = child.getBoundingClientRect();
      return {
        className: child.className,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    });
    const clip = header.querySelector<HTMLElement>(".preview-panel__clip");
    return {
      height: box.height,
      innerLeft,
      innerRight,
      items,
      clipTruncated: clip ? clip.scrollWidth > clip.clientWidth : false,
      overflows: header.scrollWidth > header.clientWidth,
    };
  }

  test("the preview header strip has even insets and gaps", async () => {
    await setViewport({ width: 1400, height: 900 });
    await render(editorGrid(PREVIEW_DEFAULT_WIDTH));

    const layout = headerLayout();
    expect(layout.height).toBeGreaterThanOrEqual(HEADER_MIN_HEIGHT);

    const tabs = layout.items[0];
    const chip = layout.items[layout.items.length - 1];
    expect(tabs.className).toContain("preview-panel__tabs");
    expect(chip.className).toContain("preview-panel__actions");
    expect(Math.abs(tabs.left - layout.innerLeft - HEADER_INSET)).toBeLessThan(
      1.01,
    );
    expect(
      Math.abs(layout.innerRight - chip.right - HEADER_INSET),
    ).toBeLessThan(1.01);

    for (let index = 1; index < layout.items.length; index += 1) {
      const gap = layout.items[index].left - layout.items[index - 1].right;
      expect(gap).toBeGreaterThanOrEqual(ITEM_GAP - 0.5);
    }
  });

  test("a narrow preview ellipsizes the clip name on one line", async () => {
    await setViewport({ width: 1400, height: 900 });
    await render(editorGrid(PREVIEW_MIN_WIDTH));
    expect(
      document.querySelector(".preview-panel__clip")?.textContent,
    ).toBe("No clip at playhead");

    const layout = headerLayout();
    expect(layout.clipTruncated).toBe(true);
    expect(layout.overflows).toBe(false);
    expect(layout.height).toBeGreaterThanOrEqual(HEADER_MIN_HEIGHT);
    // Everything shares one centered row inside the strip.
    const center = (item: { top: number; bottom: number }) =>
      (item.top + item.bottom) / 2;
    for (const item of layout.items) {
      expect(item.right).toBeLessThanOrEqual(
        layout.innerRight - HEADER_INSET + 1,
      );
      expect(item.bottom - item.top).toBeLessThan(layout.height);
      expect(Math.abs(center(item) - center(layout.items[0]))).toBeLessThan(
        1.5,
      );
    }
  });
});

describe("canvas size", () => {
  // The preview draws at the device pixels its panel covers, not at the
  // export size times the display's density, and follows the panel's size.
  // A display of density 2, as the spec's deviceScaleFactor.
  async function useDensity(deviceScaleFactor: number) {
    await cdp().send("Emulation.setDeviceMetricsOverride", {
      width: window.top?.innerWidth ?? window.innerWidth,
      height: window.top?.innerHeight ?? window.innerHeight,
      deviceScaleFactor,
      mobile: false,
    });
  }

  afterEach(async () => {
    await useDensity(1);
  });

  // The preview canvas's drawing buffer, and the one its panel calls for:
  // the export size letterboxed into the panel at the device's density, but
  // never larger than the export itself.
  function canvasSizes() {
    const canvas = document.querySelector<HTMLCanvasElement>(
      ".composition-player__canvas",
    );
    if (!canvas) {
      throw new Error("the preview canvas is not rendered");
    }
    const [outputWidth, outputHeight] = canvas.style.aspectRatio
      .split("/")
      .map(Number);
    const ratio = Math.min(
      1,
      Math.min(
        canvas.clientWidth / outputWidth,
        canvas.clientHeight / outputHeight,
      ) * window.devicePixelRatio,
    );
    return {
      buffer: { width: canvas.width, height: canvas.height },
      expected: {
        width: Math.floor(outputWidth * ratio),
        height: Math.floor(outputHeight * ratio),
      },
      output: { width: outputWidth, height: outputHeight },
    };
  }

  async function expectBufferToFitPanel() {
    await expect
      .poll(() => {
        const { buffer, expected } = canvasSizes();
        return (
          Math.abs(buffer.width - expected.width) <= 1 &&
          Math.abs(buffer.height - expected.height) <= 1
        );
      })
      .toBe(true);
  }

  test("the preview buffer follows the panel size", async () => {
    await setViewport({ width: 1600, height: 900 });
    await useDensity(2);
    expect(window.devicePixelRatio).toBe(2);
    const screen = await render(editorGrid(PREVIEW_DEFAULT_WIDTH));

    await expectBufferToFitPanel();
    const wide = canvasSizes();
    expect(wide.buffer.width).toBeLessThan(wide.output.width * 2);

    // Narrowing the panel shrinks the buffer with it.
    await screen.rerender(editorGrid(PREVIEW_MIN_WIDTH));
    await expect
      .poll(() => canvasSizes().buffer.width)
      .toBeLessThan(wide.buffer.width);
    await expectBufferToFitPanel();
  });
});
