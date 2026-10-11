// The editor panel as App lays it out, for component tests of its toolbar
// and transport: the toolbar row, the timeline area and the transport bar,
// over a capped FX row, driven by the real playback, Space and playhead
// shortcut code with a session's default settings.
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BASE_QUARTER_PX,
  INITIAL_PROJECT_STATE,
  signatureById,
} from "../../app/constants.ts";
import type { LoopRegion } from "../../app/loop-region.ts";
import { getClipDurationQ } from "../../app/timeline-math.ts";
import type {
  ArrangementClip,
  ProjectState,
  TimelineDragState,
  TimelineSelection,
} from "../../app/types.ts";
import { DesktopShell } from "../../component-test/shells.tsx";
import { usePlayback } from "../../hooks/usePlayback.ts";
import { usePreviewVolume } from "../../hooks/usePreviewVolume.ts";
import type { PlayheadSignal } from "../../playhead-signal.ts";
import { dispatchShortcuts } from "../../shortcuts/registry.ts";
import { skipShortcut, stepFrameShortcut } from "../../shortcuts/transport.ts";
import type { ShortcutContext } from "../../shortcuts/types.ts";
import { useSpacePlayback } from "../../shortcuts/useSpacePlayback.ts";
import { createSpaceHold } from "../../space-shortcut.ts";
import {
  divisionQuarters,
  resolveAdaptiveDivision,
} from "../../timeline-grid.ts";
import type { MediaDrawerTab } from "../media/media-drawer-model.ts";
import { TimelineToolbar } from "./TimelineToolbar";
import { TransportBar } from "./TransportBar";

const noop = () => {};
const LABEL_WIDTH = 0;

// A text clip, which plays without media, from `startQ` for `seconds`.
export function textClip(startQ: number, seconds: number): ArrangementClip {
  return {
    id: "text-1",
    kind: "text",
    sourceSpanId: "",
    sourceTrackId: "",
    laneId: "1",
    label: "Text",
    mediaPath: "",
    startQ,
    durationSeconds: seconds,
    trimStartSeconds: 0,
    sourceOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: seconds,
    tint: "#334",
    accent: "#f80",
  };
}

type TransportHarnessProps = {
  playheadSignal: PlayheadSignal;
  clips?: ArrangementClip[];
  loop?: LoopRegion | null;
  // Rendered above the workspace, as App renders the top bar.
  header?: ReactNode;
  // Rendered in the timeline area, inside `.timeline-scroll`.
  children?: ReactNode;
  // The timeline's scroll box, for content that needs it.
  timelineScrollRef?: RefObject<HTMLDivElement | null>;
};

export function TransportHarness({
  playheadSignal,
  clips = [],
  loop = null,
  header,
  children,
  timelineScrollRef: outerScrollRef,
}: TransportHarnessProps) {
  const [project, setProject] = useState<ProjectState>(INITIAL_PROJECT_STATE);
  const { bpm, fps, signatureId, snapEnabled, timelineMode } = project;
  const [zoomDraft, setZoomDraft] = useState<number | null>(null);
  const zoom = zoomDraft ?? project.zoom;
  const [loopRegion, setLoopRegion] = useState(loop);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineDragState, setTimelineDragState] =
    useState<TimelineDragState | null>(null);
  const [, setPendingSelection] = useState<TimelineSelection | null>(null);
  const [, setSelectedClipId] = useState<string>();
  const [, setPlayheadQState] = useState(0);
  const [mediaDrawerTab, setMediaDrawerTab] =
    useState<MediaDrawerTab>("sessions");
  const playheadQRef = useRef(playheadSignal.get());
  const playbackOriginRef = useRef(playheadSignal.get());
  const timelineClipsRef = useRef(clips);
  const ownScrollRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = outerScrollRef ?? ownScrollRef;
  const spaceHoldRef = useRef(createSpaceHold());
  const playerRef = useRef(null);
  const previewVolume = usePreviewVolume(playerRef);

  const setPlayheadQ = useCallback(
    (nextQ: number) => {
      playheadQRef.current = nextQ;
      playheadSignal.set(nextQ);
      setPlayheadQState(nextQ);
    },
    [playheadSignal],
  );
  const signature = signatureById(signatureId);
  const barLength = signature.numerator * (4 / signature.denominator);
  // As useTimelineViewport sizes the grid and the timeline.
  const quarterPx = BASE_QUARTER_PX * zoom;
  const snapUnit = divisionQuarters(resolveAdaptiveDivision(quarterPx));
  const totalQuarters = Math.max(
    barLength * 12,
    ...clips.map(
      (clip) => clip.startQ + getClipDurationQ(clip, bpm) + barLength,
    ),
  );

  const playback = usePlayback({
    playbackOriginRef,
    clips,
    timelineClips: clips,
    timelineClipsRef,
    projectMediaItems: [],
    bpm,
    barLength,
    snap: { unit: snapUnit, enabled: snapEnabled },
    quarterPx,
    totalQuarters,
    loopRegion,
    labelWidth: LABEL_WIDTH,
    timelineScrollRef,
    isPlaying,
    setIsPlaying,
    timelineDragState,
    setTimelineDragState,
    playheadQRef,
    playheadSignal,
    setPlayheadQ,
    setPlayheadQState,
    setPendingSelection,
    setSelectedClipId,
    setStatus: noop,
  });

  useSpacePlayback({
    cancelScrubPlaybackResume: playback.cancelScrubPlaybackResume,
    clipCount: playback.playableClipCount,
    dragState: null,
    isPlaying,
    isMediaTabActive: false,
    toggleMediaPlayback: noop,
    playFromLoopStart: playback.playFromLoopStart,
    setIsPlaying,
    spaceHoldRef,
    startPlayback: playback.startPlayback,
    timelineDragState,
    timelineScrollRef,
  });

  // The arrow keys' frame steps and Ctrl/Cmd+arrow skips, as
  // useKeyboardShortcuts dispatches them.
  const shortcutContext = {
    bpm,
    fps,
    dragState: null,
    timelineDragState,
    playbackOriginRef,
    playheadQRef,
    setPlayheadQ,
    skipToEdge: playback.skipToEdge,
    totalQuarters,
  } satisfies Partial<ShortcutContext>;
  const shortcutContextRef = useRef(shortcutContext);
  shortcutContextRef.current = shortcutContext;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) =>
      dispatchShortcuts(
        [stepFrameShortcut, skipShortcut],
        shortcutContextRef.current as ShortcutContext,
        event,
      );
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const commitProjectPatch = (_label: string, patch: Partial<ProjectState>) =>
    setProject((current) => ({ ...current, ...patch }));

  return (
    <DesktopShell>
      {header}
      <main className="workspace">
        <div className="workspace__main">
          <section className="editor-panel">
            <TimelineToolbar
              playheadSignal={playheadSignal}
              bpm={bpm}
              fps={fps}
              signature={signature}
              timelineMode={timelineMode}
              snapEnabled={snapEnabled}
              signatureId={signatureId}
              commitProjectChange={(_label, updater) => setProject(updater)}
              commitProjectPatch={commitProjectPatch}
              isMediaDrawerOpen={false}
              mediaDrawerTab={mediaDrawerTab}
              onSelectMediaDrawerTab={setMediaDrawerTab}
              isPlaying={isPlaying}
              isRecording={false}
            />
            <div className="editor-grid">
              <div className="timeline-scroll" ref={timelineScrollRef}>
                {children}
                {loopRegion ? (
                  <button onClick={() => setLoopRegion(null)} type="button">
                    Remove loop
                  </button>
                ) : null}
              </div>
            </div>
            <TransportBar
              resolvedZoom={zoom}
              setZoomValue={(_label, nextZoom) =>
                commitProjectPatch("Zoom", { zoom: nextZoom })
              }
              updateZoomDraft={setZoomDraft}
              flushZoomDraft={() => {
                if (zoomDraft !== null) {
                  commitProjectPatch("Zoom", { zoom: zoomDraft });
                  setZoomDraft(null);
                }
              }}
              isPlaying={isPlaying}
              jumpHalfBar={playback.jumpHalfBar}
              skipToEdge={playback.skipToEdge}
              playheadSignal={playheadSignal}
              loopRegion={loopRegion}
              playbackEndQ={playback.playbackEndQ}
              onTransportToggle={playback.handleTransportToggle}
              playFromLoopStart={playback.playFromLoopStart}
              onRandomize={noop}
              {...previewVolume}
              getMeterTap={() => null}
              canRecord={false}
              isRecording={false}
              toggleRecording={noop}
            />
          </section>
          {/* A device chain taller than the 40% cap on the FX row, which
              transport-bar.css rounds to whole pixels (#1224). */}
          <section className="fx-panel">
            <div style={{ height: 2000 }} />
          </section>
        </div>
      </main>
    </DesktopShell>
  );
}
