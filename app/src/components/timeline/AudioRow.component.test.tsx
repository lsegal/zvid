import { type MouseEvent, useState } from "react";
import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { LABEL_WIDTH_DEFAULT } from "../../app/constants.ts";
import type { ClipMenuState, Lane } from "../../app/types.ts";
import type { AudioMix } from "../../audio-mix/resolve.ts";
import { AUDIO_ROW_HEIGHT } from "../../audio-row-section.ts";
import { DesktopShell } from "../../component-test/shells.tsx";
import { setViewport } from "../../component-test/viewport.ts";
import { useAudioMix } from "../../hooks/useAudioMix.ts";
import type { MediaItem } from "../../media.ts";
import { buildAudioMenuEntries } from "../../menus/audio-menu.ts";
import { createPlayheadSignal } from "../../playhead-signal.ts";
import type { WaveformPeaks } from "../../waveform-peaks.ts";
import { TimelineContextMenu } from "../TimelineContextMenu";
import { AudioRow } from "./AudioRow";
import { LayerHeader, type LayerHeaderContext } from "./LayerHeader";
import "./timeline.css";

// The Audio row is a read-only waveform of the resolved audio mix: it takes
// no files, draws the mix's peaks, and recomputes on Refresh. Ported from
// audio-row.spec.ts, which keeps its docking in the timeline panel, its
// playhead, the collapse preference across reloads, and how clip edits and
// opened sessions change the mix.
const noop = () => {};

type AudioRowMix = Parameters<typeof AudioRow>[0]["mix"];

// The Audio row as the timeline panel's footer draws it, at the default
// label width, with a toggle that collapses it and the Audio actions menu
// its right-click opens.
function Row({ mix, quarterPx = 40 }: { mix: AudioRowMix; quarterPx?: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState<ClipMenuState | null>(null);
  const openAudioMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setMenu({ kind: "audio", anchor: { x: event.clientX, y: event.clientY } });
  };
  return (
    <div
      className="timeline-panel"
      style={{ ["--label-width" as string]: `${LABEL_WIDTH_DEFAULT}px` }}
    >
      <div className="timeline-footer">
        <div className="timeline-footer__canvas" style={{ width: 1400 }}>
        <AudioRow
          mix={mix}
          openAudioMenu={openAudioMenu}
          prefersReducedMotion={false}
          bpm={120}
          quarterPx={quarterPx}
          visibleTimelineStartPx={0}
          visibleTimelineWidthPx={1000}
          gridStyle={{}}
          playheadSignal={createPlayheadSignal()}
          isCollapsed={collapsed}
          setCollapsed={setCollapsed}
          expandedHeight={AUDIO_ROW_HEIGHT}
          onResize={noop}
        />
        </div>
      </div>
      <TimelineContextMenu
        clipMenu={menu}
        getClipMenuEntries={() => buildAudioMenuEntries({ refresh: mix.refresh })}
        onClose={() => setMenu(null)}
      />
    </div>
  );
}

// The Audio row fed by the real mix hook.
function HookedRow({
  mix,
  mediaItemsById = new Map(),
}: {
  mix: AudioMix;
  mediaItemsById?: ReadonlyMap<string, MediaItem>;
}) {
  return <Row mix={useAudioMix({ mix, mediaItemsById, refresh: noop })} />;
}

const SILENT_MIX: AudioMix = {
  clips: [],
  buses: [],
  master: [],
  masterAmplitude: 1,
  fromSourceTracks: false,
  bpm: 120,
  signature: { numerator: 4, denominator: 4 },
};

// Four seconds of a loud tone's peaks.
function tonePeaks(): WaveformPeaks {
  const buckets = 400;
  const max = new Float32Array(buckets).fill(0.6);
  const min = new Float32Array(buckets).fill(-0.6);
  return { bucketsPerSecond: 100, durationSeconds: 4, min, max };
}

// A 440 Hz tone as a 16-bit mono WAV.
function toneWav(seconds: number) {
  const sampleRate = 8000;
  const frames = Math.round(seconds * sampleRate);
  const view = new DataView(new ArrayBuffer(44 + frames * 2));
  const write = (text: string, at: number) => {
    for (let index = 0; index < text.length; index++) {
      view.setUint8(at + index, text.charCodeAt(index));
    }
  };
  write("RIFF", 0);
  view.setUint32(4, view.byteLength - 8, true);
  write("WAVEfmt ", 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write("data", 36);
  view.setUint32(40, frames * 2, true);
  for (let index = 0; index < frames; index++) {
    const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    view.setInt16(44 + index * 2, Math.round(sample * 10_000), true);
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

const urls: string[] = [];
afterEach(() => {
  for (const url of urls.splice(0)) {
    URL.revokeObjectURL(url);
  }
});

// A source clip playing a tone at 0 dB, from the start of the timeline.
function toneMix() {
  const previewUrl = URL.createObjectURL(toneWav(3));
  urls.push(previewUrl);
  const media: MediaItem = {
    id: `tone-${urls.length}-${Date.now()}`,
    name: "tone.wav",
    kind: "audio",
    durationSeconds: 3,
    hasAudio: true,
    hasVideo: false,
    color: "#000",
    accent: "#000",
    previewUrl,
    availability: "ready",
  };
  const mix: AudioMix = {
    ...SILENT_MIX,
    fromSourceTracks: true,
    clips: [
      {
        id: "tone",
        mediaId: media.id,
        startSeconds: 0,
        durationSeconds: 3,
        sourceOffsetSeconds: 0,
        sourceWindowStartSeconds: 0,
        sourceWindowEndSeconds: 3,
        mediaDurationSeconds: 3,
        effects: [],
        amplitude: 1,
        hasGain: true,
        busId: "track",
        stages: [],
      },
    ],
    buses: [{ id: "track", stages: [] }],
  };
  return { mix, mediaItemsById: new Map([[media.id, media]]) };
}

function audioRow() {
  const row = document.querySelector<HTMLElement>("[data-audio-row]");
  if (!row) {
    throw new Error("No Audio row");
  }
  return row;
}

function mixContent() {
  const content = audioRow().querySelector<HTMLElement>("[data-audio-mix]");
  if (!content) {
    throw new Error("No mix content");
  }
  return content;
}

// The mix's loudest point as the Audio row drew it.
function drawnLevel() {
  return Number(mixContent().getAttribute("data-audio-mix-level"));
}

function toggle() {
  const button = audioRow().querySelector<HTMLElement>(".audio-row__toggle");
  if (!button) {
    throw new Error("No toggle");
  }
  return button;
}

test("the Audio row takes no files and starts empty", async () => {
  const screen = await render(
    <DesktopShell>
      <HookedRow mix={SILENT_MIX} />
    </DesktopShell>,
  );
  const row = screen.getByRole("region", { name: "Audio" });
  await expect.poll(() => row.element().textContent).toContain("No audio");
  expect(audioRow().querySelectorAll('input[type="file"]')).toHaveLength(0);
  await expect
    .element(row.getByRole("button", { name: "Recompute audio" }))
    .toBeVisible();
  expect(row.getByRole("button", { name: /main audio/i }).elements()).toEqual(
    [],
  );

  await row.element().querySelector(".track-label")?.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 40 }),
  );
  const menu = page.getByRole("menu", { name: "Audio actions" });
  await expect.element(menu).toBeVisible();
  expect(
    menu
      .getByRole("menuitem")
      .elements()
      .map((item) => item.textContent),
  ).toEqual(["Recompute audio"]);
  await userEvent.keyboard("{Escape}");
  await expect.element(menu).not.toBeInTheDocument();
});

test("the Audio row's badge centers its glyph like the layers' badges", async () => {
  const lane: Lane = { id: "1", name: "Layer 1", colorIndex: 0 };
  const header = {
    layerReorder: { gripProps: () => ({}) },
    renamingLaneId: undefined,
    setRenamingLaneId: noop,
    readOnly: false,
    openLayerMenu: noop,
    selectLaneFromLabel: noop,
    focusLaneLabel: noop,
    commitLayerRename: noop,
    setLayerFxEnabled: noop,
    setLayerHidden: noop,
    toggleRowCollapsed: noop,
    resizeRow: noop,
  } as unknown as LayerHeaderContext;
  await render(
    <DesktopShell>
      <div className="track-row">
        <LayerHeader
          lane={lane}
          laneIndex={0}
          fxLaneId={lane.id}
          status={{ effectCount: 0, summary: "" }}
          height={78}
          expandedHeight={78}
          {...header}
        />
      </div>
      <HookedRow mix={SILENT_MIX} />
    </DesktopShell>,
  );
  // The glyph's box against the badge's, from each center.
  const glyphOffset = (node: Element) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const glyph = range.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return [
      Math.round(glyph.left + glyph.width / 2 - (box.left + box.width / 2)),
      Math.round(glyph.top + glyph.height / 2 - (box.top + box.height / 2)),
    ];
  };
  const audioBadge = audioRow().querySelector(".track-label__index");
  const layerBadge = document.querySelector(
    "[data-layer-header-id] .track-label__index",
  );
  if (!audioBadge || !layerBadge) {
    throw new Error("No badges");
  }
  expect(audioBadge.textContent).toBe("A");
  const [x, y] = glyphOffset(audioBadge);
  expect(Math.abs(x)).toBeLessThanOrEqual(1);
  expect([x, y]).toEqual(glyphOffset(layerBadge));
});

test("the collapsed Audio row is 44px and still draws the waveform at its height", async () => {
  await setViewport({ width: 1600, height: 1200 });
  const peaks = tonePeaks();
  const mix: AudioRowMix = {
    summary: "From source tracks · 1 clip",
    peaks,
    computing: false,
    durationSeconds: peaks.durationSeconds,
    refresh: noop,
  };
  await render(
    <DesktopShell>
      <Row mix={mix} />
    </DesktopShell>,
  );
  expect(mixContent().getAttribute("data-audio-mix")).toBe("ready");

  expect(toggle().getAttribute("aria-expanded")).toBe("true");
  expect(toggle().title).toBe("Collapse audio row");
  const expandedHeight = audioRow().getBoundingClientRect().height;
  const canvas = () => {
    const element = mixContent().querySelector<HTMLCanvasElement>(
      ".waveform__canvas",
    );
    if (!element) {
      throw new Error("No waveform canvas");
    }
    return element;
  };
  await expect.poll(() => canvas().height).toBeGreaterThan(0);
  const expandedCanvasHeight = canvas().height;

  await userEvent.click(toggle());
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
  expect(toggle().title).toBe("Expand audio row");
  const collapsedHeight = audioRow().getBoundingClientRect().height;
  expect(collapsedHeight).toBeLessThan(expandedHeight);
  // As short as a collapsed layer (#1057, #1077).
  expect(collapsedHeight).toBe(44);

  // Compact, not hidden: the waveform is drawn at the slim height.
  await expect.element(canvas()).toBeVisible();
  // Inset 8px, like a collapsed layer's clips.
  const rowTop = audioRow().getBoundingClientRect().y;
  const canvasBox = canvas().getBoundingClientRect();
  expect(canvasBox.height).toBe(28);
  expect(Math.abs(canvasBox.y - rowTop - 8)).toBeLessThanOrEqual(0.5);
  expect(drawnLevel()).toBeGreaterThan(0.1);

  // Collapsing redraws the canvas at its new height rather than squashing
  // the expanded drawing.
  await expect
    .poll(
      () =>
        canvas().height ===
        Math.round(canvas().clientHeight * (window.devicePixelRatio || 1)),
    )
    .toBe(true);
  expect(canvas().height).toBeLessThan(expandedCanvasHeight);
});

test("a clip with audio draws the mix, and Refresh recomputes it", async () => {
  const { mix, mediaItemsById } = toneMix();
  const screen = await render(
    <DesktopShell>
      <HookedRow mix={mix} mediaItemsById={mediaItemsById} />
    </DesktopShell>,
  );
  const row = screen.getByRole("region", { name: "Audio" });
  await expect
    .poll(() => row.element().textContent)
    .toContain("From source tracks · 1 clip");
  await expect
    .poll(() => mixContent().getAttribute("data-audio-mix"), {
      timeout: 30_000,
    })
    .toBe("ready");
  await expect
    .element(row.element().querySelector(".waveform__canvas"))
    .toBeVisible();
  await expect.poll(drawnLevel).toBeGreaterThan(0.1);

  // Refresh resolves the mix again and draws it anew. The recompute can
  // finish before an assertion polls, so record every state the mix passes
  // through instead of trying to catch the brief "computing" one.
  const leftStates: string[] = [];
  new MutationObserver((records) => {
    for (const record of records) {
      leftStates.push(record.oldValue ?? "");
    }
  }).observe(mixContent(), {
    attributeFilter: ["data-audio-mix"],
    attributeOldValue: true,
  });
  await row.getByRole("button", { name: "Recompute audio" }).click();
  // The mix left "ready" to compute, then left "computing" for "ready".
  await expect
    .poll(() => leftStates, { timeout: 30_000 })
    .toEqual(["ready", "computing"]);
  expect(mixContent().getAttribute("data-audio-mix")).toBe("ready");
  await expect.poll(drawnLevel).toBeGreaterThan(0.1);
});
