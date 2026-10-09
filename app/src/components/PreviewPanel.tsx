import { ChartBarIcon } from "@heroicons/react/16/solid";
import type {
  ComponentProps,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { PREVIEW_DEFAULT_WIDTH, PREVIEW_MIN_WIDTH } from "../app/constants.ts";
import type { ArrangementClip, Lane, TimelineDragState } from "../app/types.ts";
import type { AudioMix } from "../audio-mix/resolve.ts";
import {
  CompositionPlayer,
  type CompositionPlayerHandle,
} from "../CompositionPlayer";
import {
  type ClipMediaState,
  describePreviewMediaState,
} from "../clip-media-state";
import {
  MEDIA_FRAME_ID,
  PROGRAM_FRAME_ID,
  previewFrameAnalysis,
} from "../fx-shaders/frame-analysis.ts";
import type { SessionEffect } from "../fx-stack";
import { useLivePreviewLayers } from "../hooks/useLivePreviewLayers.ts";
import type { MediaPreviewModel } from "../hooks/useMediaPreview.ts";
import type { usePreview } from "../hooks/usePreview.ts";
import type { usePreviewEditing } from "../hooks/usePreviewEditing.ts";
import type { MediaItem } from "../media";
import type { PlayheadSignal } from "../playhead-signal";
import type { PreviewLayer } from "../preview-edit.ts";
import type { TimeValueFormat } from "../time-value.ts";
import { MediaPreview } from "./MediaPreview";
import type { MediaRangeActions } from "./MediaRangeBar";
import { PreviewTransformOverlay } from "./PreviewTransformOverlay";
import { ScopesPane, useScopesPane } from "./scopes/ScopesPane";
import "./preview-panel.css";

type PreviewEditing = ReturnType<typeof usePreviewEditing>;

export type PreviewPanelProps = Pick<
  PreviewEditing,
  | "activatePreviewLayer"
  | "getPreviewLayerPosition"
  | "getPreviewLayerTransform"
  | "movePreviewLayer"
  | "previewTextEdit"
  | "selectPreviewLayer"
  | "textEdit"
  | "transformPreviewLayer"
> & {
  bpm: number;
  canvasHeight: number;
  canvasWidth: number;
  commitPreviewWidth: (nextWidth: number) => void;
  compositionPlayerRef: RefObject<CompositionPlayerHandle | null>;
  effectivePreviewWidth: number;
  fps: number;
  handlePreviewResizeKeyDown: (
    event: ReactKeyboardEvent<HTMLHRElement>,
  ) => void;
  handlePreviewResizePointerDown: (
    event: ReactPointerEvent<HTMLHRElement>,
  ) => void;
  handlePreviewResizePointerEnd: (
    event: ReactPointerEvent<HTMLHRElement>,
  ) => void;
  handlePreviewResizePointerMove: (
    event: ReactPointerEvent<HTMLHRElement>,
  ) => void;
  hasOnlinePlayheadClip: boolean;
  isPlaying: boolean;
  isTimelineAudibleScrubbing: boolean;
  audioMix: AudioMix;
  mediaItems: MediaItem[];
  mediaPreview: MediaPreviewModel;
  mediaRange: MediaRangeActions;
  mediaTimeFormat: TimeValueFormat;
  playheadSignal: PlayheadSignal;
  previewClip: ArrangementClip | undefined;
  previewLaneId: string | undefined;
  previewLayers: ReturnType<typeof usePreview>["previewLayers"];
  resolvePreviewLayersAt: ReturnType<
    typeof usePreview
  >["resolvePreviewLayersAt"];
  previewMaxWidth: number;
  previewMedia: MediaItem | undefined;
  previewMediaState: ClipMediaState;
  previewVolume: { volume: number; muted: boolean };
  projectDurationFrames: number | undefined;
  // What the compositor draws: the layer clips and layers, or the source
  // tracks rendered as layers when there are no layer clips.
  renderClips: ArrangementClip[];
  renderLanes: Lane[];
  // The effects the render clips draw with (see resolveRenderClips).
  renderEffects: SessionEffect[];
  renderFromSourceTracks: boolean;
  selectedClip: ArrangementClip | undefined;
  timelineDragState: TimelineDragState | null;
};

const PREVIEW_TABS = [
  { tab: "timeline", label: "Timeline" },
  { tab: "media", label: "Media" },
] as const;

// The transform overlay with the selected layer's box where the live
// playhead puts it, so it keeps up with an animating layer during playback
// and scrubbing. Only the overlay re-renders as the playhead moves.
function LivePreviewTransformOverlay({
  layers,
  resolveLayersAt,
  playheadSignal,
  ...props
}: ComponentProps<typeof PreviewTransformOverlay> & {
  resolveLayersAt: (playheadQ: number) => readonly PreviewLayer[];
  playheadSignal: PlayheadSignal;
}) {
  const liveLayers = useLivePreviewLayers({
    layers,
    resolveLayersAt,
    playheadSignal,
    selectedLaneId: props.selectedLaneId,
  });
  return <PreviewTransformOverlay {...props} layers={liveLayers} />;
}

// What the Scopes pane analyzes: the media the Media tab plays, or the
// program frame the compositor draws. Audio has no picture to analyze.
function scopesSource(isMediaTab: boolean, media: MediaItem | undefined) {
  if (isMediaTab && !media) {
    return { frameId: null, emptyMessage: "Select media to see its scopes." };
  }
  if (isMediaTab ? !media?.hasVideo : media?.kind === "audio") {
    return {
      frameId: null,
      emptyMessage: "Audio only: there is no picture to analyze.",
    };
  }
  return {
    frameId: isMediaTab ? MEDIA_FRAME_ID : PROGRAM_FRAME_ID,
    emptyMessage: "",
  };
}

// The preview pane beside the timeline, with the handle that resizes it. Its
// Timeline tab is the Program monitor: the composition player, the transform
// and text overlays, and the placeholder shown when nothing at the playhead
// can be drawn. Its Media tab plays the media chosen in the Media drawer.
export function PreviewPanel({
  activatePreviewLayer,
  bpm,
  canvasHeight,
  canvasWidth,
  commitPreviewWidth,
  compositionPlayerRef,
  effectivePreviewWidth,
  fps,
  getPreviewLayerPosition,
  getPreviewLayerTransform,
  handlePreviewResizeKeyDown,
  handlePreviewResizePointerDown,
  handlePreviewResizePointerEnd,
  handlePreviewResizePointerMove,
  hasOnlinePlayheadClip,
  isPlaying,
  isTimelineAudibleScrubbing,
  audioMix,
  mediaItems,
  mediaPreview,
  mediaRange,
  mediaTimeFormat,
  movePreviewLayer,
  playheadSignal,
  previewClip,
  previewLaneId,
  previewLayers,
  previewMaxWidth,
  previewMedia,
  previewMediaState,
  previewTextEdit,
  previewVolume,
  projectDurationFrames,
  renderClips,
  renderEffects,
  renderFromSourceTracks,
  renderLanes,
  resolvePreviewLayersAt,
  selectPreviewLayer,
  selectedClip,
  textEdit,
  timelineDragState,
  transformPreviewLayer,
}: PreviewPanelProps) {
  const { previewTab, previewMediaItem: mediaItem } = mediaPreview;
  const isMediaTab = previewTab === "media";
  const scopesPane = useScopesPane();
  const previewedMedia = isMediaTab ? mediaItem : previewMedia;
  const scopes = scopesPane.open ? (
    <ScopesPane
      pane={scopesPane}
      {...scopesSource(isMediaTab, previewedMedia)}
    />
  ) : null;
  return (
    <>
      <hr
        className="preview-resize-handle"
        aria-orientation="vertical"
        aria-label="Resize preview panel"
        aria-valuenow={effectivePreviewWidth}
        aria-valuemin={PREVIEW_MIN_WIDTH}
        aria-valuemax={previewMaxWidth}
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
        onPointerDown={handlePreviewResizePointerDown}
        onPointerMove={handlePreviewResizePointerMove}
        onPointerUp={handlePreviewResizePointerEnd}
        onPointerCancel={handlePreviewResizePointerEnd}
        onDoubleClick={() => commitPreviewWidth(PREVIEW_DEFAULT_WIDTH)}
        onKeyDown={handlePreviewResizeKeyDown}
      />

      <aside className="preview-panel">
        <div className="preview-panel__header">
          <div
            className="segmented-control preview-panel__tabs"
            role="tablist"
            aria-label="Preview"
          >
            {PREVIEW_TABS.map(({ tab, label }) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={previewTab === tab}
                className={previewTab === tab ? "is-active" : ""}
                onClick={() => mediaPreview.selectPreviewTab(tab)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="preview-panel__heading">
            {isMediaTab ? (
              <strong className="preview-panel__title">
                {mediaItem?.name ?? "Media"}
              </strong>
            ) : (
              <>
                <strong className="preview-panel__title">Program</strong>
                <span className="preview-panel__clip">
                  {previewClip ? previewClip.label : "No clip at playhead"}
                </span>
              </>
            )}
          </div>
          <div className="preview-panel__actions">
            <button
              type="button"
              className="preview-panel__scopes"
              aria-label="Scopes"
              aria-pressed={scopesPane.open}
              title={scopesPane.open ? "Hide scopes" : "Show scopes"}
              onClick={scopesPane.toggle}
            >
              <ChartBarIcon aria-hidden="true" />
            </button>
            <span className="preview-panel__mode">
              {previewedMedia?.kind === "audio" ? "Audio" : "Video"}
            </span>
          </div>
        </div>

        <div
          className="preview-monitor"
          data-preview-tab={previewTab}
          data-render-source={
            renderFromSourceTracks ? "source-tracks" : "layers"
          }
        >
          <CompositionPlayer
            ref={compositionPlayerRef}
            bpm={bpm}
            fps={fps}
            signature={mediaTimeFormat.signature}
            canvasHeight={canvasHeight}
            canvasWidth={canvasWidth}
            clips={renderClips}
            effects={renderEffects}
            isPlaying={isPlaying}
            isScrubbing={Boolean(timelineDragState)}
            isAudibleScrubbing={isTimelineAudibleScrubbing}
            isContinuousScrubbing={Boolean(timelineDragState?.wasPlaying)}
            lanes={renderLanes}
            audioMix={audioMix}
            mediaItems={mediaItems}
            playheadSignal={playheadSignal}
            projectDurationFrames={projectDurationFrames}
            hiddenTextClipId={textEdit?.clipId}
            frameAnalysis={previewFrameAnalysis}
          />
          <LivePreviewTransformOverlay
            canvas={{ width: canvasWidth, height: canvasHeight }}
            layers={previewLayers}
            resolveLayersAt={resolvePreviewLayersAt}
            playheadSignal={playheadSignal}
            selectedLaneId={previewLaneId}
            selectedClipId={selectedClip?.id}
            textEdit={previewTextEdit}
            getLayerPosition={getPreviewLayerPosition}
            getLayerTransform={getPreviewLayerTransform}
            onSelect={selectPreviewLayer}
            onMove={movePreviewLayer}
            onTransform={transformPreviewLayer}
            onActivate={activatePreviewLayer}
          />
          {!previewClip ||
          (previewMediaState !== "online" && !hasOnlinePlayheadClip) ? (
            <div className="preview-placeholder">
              <div className="preview-placeholder__overlay">
                <strong>
                  {!previewClip || previewMediaState === "online"
                    ? "No clip at playhead"
                    : describePreviewMediaState(previewMediaState).title}
                </strong>
                <span>
                  {!previewClip || previewMediaState === "online"
                    ? isPlaying
                      ? "The playhead is currently in a gap between clips."
                      : "Move the playhead onto a clip or start playback to render the session comp."
                    : describePreviewMediaState(previewMediaState).detail}
                </span>
              </div>
            </div>
          ) : null}
          {isMediaTab ? (
            <MediaPreview
              media={mediaItem}
              isPlaying={mediaPreview.isMediaPlaying}
              setPlaying={mediaPreview.setMediaPlaying}
              timeFormat={mediaTimeFormat}
              volume={previewVolume}
              projectFps={mediaTimeFormat.fps}
              mediaRange={mediaRange}
              scopes={scopes}
            />
          ) : null}
          {isMediaTab ? null : scopes}
        </div>
      </aside>
    </>
  );
}
