import { useCallback, useState } from "react";
import { expect } from "vitest";
import { renderHook } from "vitest-browser-react";
import { patchProjectState } from "../app/session-project.ts";
import { getShortcutLabels } from "../app/shortcut-labels.ts";
import type {
  ArrangementClip,
  ProjectState,
  TimelineSelection,
} from "../app/types.ts";
import {
  ClipCard,
  type ClipCardContext,
} from "../components/timeline/ClipCard";
import type { SessionEffect } from "../fx-stack";
import { useClipInsertion } from "../hooks/useClipInsertion.ts";
import { createLaneId, getNextLaneName, insertLane } from "../lanes.ts";
import {
  createProjectHistoryState,
  type ProjectHistoryState,
  projectHistoryReducer,
} from "../project-history";
import { FxEditor, type FxEditorProps } from "./fx-editor.tsx";
import { type Frame, pixelAt, renderFrame } from "./fx-render.ts";

// Fixtures for the FX clip tests: the timeline's clip insertion and layer
// insertion, the FX panel beside the selected clip's timeline card, and
// sampling compositor frames for solid colors.

export type Rgb = [number, number, number];

export const RED: Rgb = [255, 0, 0];
export const GREEN: Rgb = [0, 255, 0];
export const BLUE: Rgb = [0, 0, 255];
export const YELLOW: Rgb = [255, 255, 0];
export const WHITE: Rgb = [255, 255, 255];
export const CYAN: Rgb = [0, 255, 255];
export const MAGENTA: Rgb = [255, 0, 255];
export const BLACK: Rgb = [0, 0, 0];

// An effect on stack `trackId` with `parameters`, numbers also set as
// their numeric values.
export function effect(
  id: string,
  trackId: string,
  effectName: string,
  parameters: Record<string, string | number>,
): SessionEffect {
  return {
    id,
    trackId,
    effectName,
    enabled: true,
    parameters: Object.entries(parameters).map(([key, value]) => ({
      key,
      value: String(value),
      ...(typeof value === "number" ? { numericValue: value } : {}),
    })),
  };
}

// A solid Color effect painting stack `trackId` `color`.
export function solidColor(id: string, trackId: string, color: string) {
  return effect(id, trackId, "Color", {
    Mode: "Solid",
    Color: color,
    Opacity: 1,
  });
}

// A fill (`kind` "fill") or FX clip (`kind` "fx") on layer `laneId` from
// `start` to `end` seconds at 120 BPM.
export function sceneClip(
  id: string,
  kind: "fill" | "fx",
  laneId: string,
  start: number,
  end: number,
): ArrangementClip {
  return {
    id,
    kind,
    sourceSpanId: "",
    sourceTrackId: "",
    laneId,
    label: kind,
    mediaPath: "",
    // 120 BPM: two quarters a second.
    startQ: start * 2,
    durationSeconds: end - start,
    trimStartSeconds: 0,
    sourceOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: end - start,
    tint: "#000",
    accent: "#fff",
  } as ArrangementClip;
}

// Layers "1" to "`count`", named "Layer N".
export function sceneLanes(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${index + 1}`,
    name: `Layer ${index + 1}`,
    colorIndex: index,
  }));
}

// The colors of `frame` at `samples`, fractions of it from its top left.
export function sampleColors(
  frame: Frame,
  samples: ReadonlyArray<readonly [number, number]>,
): Rgb[] {
  return samples.map(([x, y]) => {
    const [r, g, b] = pixelAt(
      frame,
      Math.floor(x * frame.width),
      Math.floor(y * frame.height),
    );
    return [r, g, b];
  });
}

// Each sample within 8 levels of its expected color in every channel.
export function expectColors(actual: Rgb[], expected: Rgb[]) {
  expect(actual).toHaveLength(expected.length);
  for (const [index, color] of expected.entries()) {
    for (const [channel, value] of color.entries()) {
      expect(
        Math.abs(actual[index][channel] - value),
        `sample ${index}: rgb(${actual[index]})`,
      ).toBeLessThan(8);
    }
  }
}

// The project after Insert layer below on the last layer, `count` times:
// Layer 2 is "2", Layer 3 "3", each with its own Layout.
export function withLayersBelow(project: ProjectState, count: number) {
  let next = project;
  for (let index = 0; index < count; index += 1) {
    const lane = {
      id: createLaneId(next.lanes),
      name: getNextLaneName(next.lanes),
      colorIndex: -1,
    };
    next = patchProjectState(next, insertLane(next, next.lanes.length, lane));
  }
  return next;
}

// Runs one of the timeline's clip insertions, as the selection menu's
// Insert FX Clip or a layer's Insert text at playhead do, over a pending
// timeline selection. Returns the project, the new clip's id, the clip the
// timeline then selects and the timeline selection left.
export async function insertClip(
  project: ProjectState,
  kind: "fx" | "text",
  laneId: string,
  startQ: number,
  durationQ: number,
) {
  let history: ProjectHistoryState<ProjectState> =
    createProjectHistoryState(project);
  let pendingSelection: TimelineSelection | null = {
    id: "selection",
    laneId,
    startQ,
    durationQ,
  };
  let selectedClipId: string | undefined;
  const apply = <T,>(value: T | ((current: T) => T), current: T) =>
    typeof value === "function" ? (value as (current: T) => T)(current) : value;
  const noop = () => {};
  const { result } = await renderHook(() =>
    useClipInsertion({
      barLength: 4,
      bpm: project.bpm,
      clips: project.clips,
      commitProjectChange: (label, updater) => {
        history = projectHistoryReducer(history, {
          type: "commit",
          label,
          updater,
        });
      },
      dispatchProject: (action) => {
        history = projectHistoryReducer(history, action);
      },
      fps: project.fps,
      lanes: project.lanes,
      mediaItemsById: new Map(),
      pendingSelection,
      playbackOriginRef: { current: 0 },
      projectDurationFrames: project.projectDurationFrames,
      setDragPreviewClips: noop,
      setIsPlaying: noop,
      setPendingSelection: (value) => {
        pendingSelection = apply(value, pendingSelection);
      },
      setPlayheadQ: noop,
      setSelectedClipId: (value) => {
        selectedClipId = apply(value, selectedClipId);
      },
      setStatus: noop,
      sourceSpans: project.sourceSpans,
      sourceTracks: project.sourceTracks,
    }),
  );
  const insert =
    kind === "fx" ? result.current.insertFxClip : result.current.insertTextClip;
  const clipId = insert(laneId, startQ, durationQ);
  if (!clipId) {
    throw new Error(`No ${kind} clip was inserted`);
  }
  return {
    project: history.present,
    clipId,
    selectedClipId,
    pendingSelection,
  };
}

const noop = () => {};

const CARD_CONTEXT: Omit<
  ClipCardContext,
  "selectedClipIds" | "bpm" | "timelineEffects" | "effects"
> = {
  dragState: null,
  quarterPx: 40,
  visibleTimelineStartPx: 0,
  visibleTimelineWidthPx: 1000,
  signature: { id: "sig-1", numerator: 4, denominator: 4 },
  mediaItemsById: new Map(),
  thumbnails: { get: () => undefined },
  clipPieces: new Map(),
  clipFilmstrips: new Map(),
  remoteMediaProgress: new Map(),
  prefersReducedMotion: true,
  revealedMediaIds: new Set(),
  shortcutLabels: getShortcutLabels(),
  openArrangementClipMenu: noop,
  startTextEdit: noop,
  setPendingSelection: noop,
  setDragPreviewClips: noop,
  setSelectedClipId: noop,
  setDragState: noop,
};

// FxEditor with each clip of the project as the timeline draws its card,
// in a `[data-timeline-lane-id]` row per layer, following the edits; the
// selection's clip is the selected card.
export function FxClipEditor(props: FxEditorProps) {
  const { onChange } = props;
  const [project, setProject] = useState(props.project);
  const handleChange = useCallback<NonNullable<FxEditorProps["onChange"]>>(
    (history) => {
      setProject(history.present);
      onChange?.(history);
    },
    [onChange],
  );
  return (
    <>
      <div className="fx-clip-timeline">
        {project?.lanes.map((lane) => (
          <div
            data-timeline-lane-id={lane.id}
            key={lane.id}
            style={{ position: "relative", height: 48 }}
          >
            {project.clips
              .filter((clip) => clip.laneId === lane.id)
              .map((clip) => (
                <ClipCard
                  clip={clip}
                  key={clip.id}
                  {...CARD_CONTEXT}
                  bpm={project.bpm}
                  effects={project.effects}
                  selectedClipIds={
                    new Set(props.selection?.clipId ? [props.selection.clipId] : [])
                  }
                  timelineEffects={project.effects}
                />
              ))}
          </div>
        ))}
      </div>
      <FxEditor {...props} onChange={handleChange} />
    </>
  );
}

export type Samples = Array<[number, number]>;

// Renders `clips` on `laneCount` layers with `effects` at `playheadSeconds`
// (120 BPM) on a `size`×`size` canvas.
export function renderScene(
  laneCount: number,
  clips: ReturnType<typeof sceneClip>[],
  effects: SessionEffect[],
  playheadSeconds: number,
  size: number,
) {
  return renderFrame(
    {
      mediaItems: [],
      clips,
      lanes: sceneLanes(laneCount),
      effects,
      bpm: 120,
      fps: 30,
      canvasWidth: size,
      canvasHeight: size,
    },
    // 120 BPM: two quarters a second.
    playheadSeconds * 2,
    playheadSeconds,
  );
}

export type OrderScenario = {
  // Layers, from Layer 1 down: a fill color, or `fx` for an FX clip
  // "fx-<layer>" over 0-2 s. Fills last 0-4 s.
  layers: string[];
  effects: SessionEffect[];
  playheadSeconds: number;
  samples: Samples;
  size?: number;
  // Parameters of the Global Vertical Order besides its arrangement.
  globalOrder?: SessionEffect["parameters"];
};

// Renders the layers under a Global Vertical Order and returns the colors
// at `samples`, fractions of the canvas from its top-left corner.
export async function renderOrder({
  layers,
  effects,
  playheadSeconds,
  samples,
  size = 120,
  globalOrder = [],
}: OrderScenario): Promise<Rgb[]> {
  const clips = layers.map((layer, index) => {
    const laneId = `${index + 1}`;
    return layer === "fx"
      ? sceneClip(`fx-${laneId}`, "fx", laneId, 0, 2)
      : sceneClip(`fill-${laneId}`, "fill", laneId, 0, 4);
  });
  const colors = layers.flatMap((layer, index) =>
    layer === "fx"
      ? []
      : [solidColor(`color-${index + 1}`, `${index + 1}`, layer)],
  );
  const global: SessionEffect = {
    id: "order-global",
    trackId: "__group_main",
    effectName: "Order",
    enabled: true,
    parameters: [{ key: "Arrangement", value: "Vertical" }, ...globalOrder],
  };
  const frame = await renderScene(
    layers.length,
    clips,
    [global, ...colors, ...effects],
    playheadSeconds,
    size,
  );
  return sampleColors(frame, samples);
}
