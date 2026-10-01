import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { PREVIEW_DEFAULT_WIDTH, PREVIEW_MIN_WIDTH } from "../app/constants.ts";
import type { ArrangementClip, Lane, TimelineDragState } from "../app/types.ts";
import {
  CompositionPlayer,
  type CompositionPlayerHandle,
} from "../CompositionPlayer";
import {
  type ClipMediaState,
  describePreviewMediaState,
} from "../clip-media-state";
import type { SessionEffect } from "../fx-stack";
import type { usePreviewEditing } from "../hooks/usePreviewEditing.ts";
import type { usePreviewLayers } from "../hooks/usePreviewLayers.ts";
import type { MediaItem } from "../media";
import type { PlayheadSignal } from "../playhead-signal";
import { PreviewTransformOverlay } from "./PreviewTransformOverlay";
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
  mainAudio: MediaItem | undefined;
  mediaItems: MediaItem[];
  playheadQ: number;
  playheadSeconds: number;
  playheadSignal: PlayheadSignal;
  previewClip: ArrangementClip | undefined;
  previewLaneId: string | undefined;
  previewLayers: ReturnType<typeof usePreviewLayers>;
  previewMaxWidth: number;
  previewMedia: MediaItem | undefined;
  previewMediaState: ClipMediaState;
  projectDurationFrames: number | undefined;
  // What the compositor draws: the layer clips and layers, or the source
  // tracks rendered as layers when there are no layer clips.
  renderClips: ArrangementClip[];
  renderLanes: Lane[];
  renderFromSourceTracks: boolean;
  selectedClip: ArrangementClip | undefined;
  timelineDragState: TimelineDragState | null;
  timelineEffects: SessionEffect[];
};

// The Program monitor beside the timeline, with the handle that resizes it:
// the composition player, the transform and text overlays, and the
// placeholder shown when nothing at the playhead can be drawn.
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
  mainAudio,
  mediaItems,
  movePreviewLayer,
  playheadQ,
  playheadSeconds,
  playheadSignal,
  previewClip,
  previewLaneId,
  previewLayers,
  previewMaxWidth,
  previewMedia,
  previewMediaState,
  previewTextEdit,
  projectDurationFrames,
  renderClips,
  renderFromSourceTracks,
  renderLanes,
  selectPreviewLayer,
  selectedClip,
  textEdit,
  timelineDragState,
  timelineEffects,
  transformPreviewLayer,
}: PreviewPanelProps) {
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
          <strong>Program</strong>
          <span className="preview-panel__clip">
            {previewClip ? previewClip.label : "No clip at playhead"}
          </span>
          <span className="preview-panel__mode">
            {previewMedia?.kind === "audio" ? "Audio" : "Video"}
          </span>
        </div>

        <div
          className="preview-monitor"
          data-render-source={
            renderFromSourceTracks ? "source-tracks" : "layers"
          }
        >
          <CompositionPlayer
            ref={compositionPlayerRef}
            bpm={bpm}
            fps={fps}
            canvasHeight={canvasHeight}
            canvasWidth={canvasWidth}
            clips={renderClips}
            effects={timelineEffects}
            isPlaying={isPlaying}
            isScrubbing={Boolean(timelineDragState)}
            isAudibleScrubbing={isTimelineAudibleScrubbing}
            isContinuousScrubbing={Boolean(timelineDragState?.wasPlaying)}
            lanes={renderLanes}
            mainAudio={mainAudio}
            mediaItems={mediaItems}
            playheadQ={playheadQ}
            playheadSeconds={playheadSeconds}
            playheadSignal={playheadSignal}
            projectDurationFrames={projectDurationFrames}
            hiddenTextClipId={textEdit?.clipId}
          />
          <PreviewTransformOverlay
            canvas={{ width: canvasWidth, height: canvasHeight }}
            layers={previewLayers}
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
        </div>
      </aside>
    </>
  );
}
