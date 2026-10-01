import { SIGNATURE_OPTIONS, SNAP_OPTIONS } from "../../app/constants.ts";
import type {
  Lane,
  ProjectState,
  TimelineMode,
  TimeSignature,
} from "../../app/types.ts";
import { getNextLaneNumber } from "../../app/util.ts";
import type { PlayheadSignal } from "../../playhead-signal";
import { MAX_LAYERS } from "../../selection-overlaps";
import {
  formatDivision,
  type GridDivision,
  type SnapMode,
} from "../../timeline-grid";
import { TransportPlayheadReadout } from "../LivePlayhead";
import { MEDIA_DRAWER_ID } from "../media/MediaDrawer";
import { Select } from "../ui/select";
import "./timeline-toolbar.css";

type TimelineToolbarProps = {
  playheadSignal: PlayheadSignal;
  bpm: number;
  fps: number;
  signature: TimeSignature;
  timelineMode: TimelineMode;
  snapMode: SnapMode;
  adaptiveDivision: GridDivision;
  snapEnabled: boolean;
  signatureId: string;
  lanes: Lane[];
  canCreateLayer: boolean;
  commitProjectPatch: (label: string, patch: Partial<ProjectState>) => void;
  onCreateLayer: () => void;
  isMediaDrawerOpen: boolean;
  onToggleMediaDrawer: () => void;
};

// The Media drawer toggle, the playhead readout and the timeline's scale,
// snap, time signature and layer controls above the timeline.
export function TimelineToolbar({
  playheadSignal,
  bpm,
  fps,
  signature,
  timelineMode,
  snapMode,
  adaptiveDivision,
  snapEnabled,
  signatureId,
  lanes,
  canCreateLayer,
  commitProjectPatch,
  onCreateLayer,
  isMediaDrawerOpen,
  onToggleMediaDrawer,
}: TimelineToolbarProps) {
  return (
    <div className="timeline-toolbar">
      <div className="timeline-toolbar__display">
        <div className="segmented-control">
          <button
            aria-controls={MEDIA_DRAWER_ID}
            aria-expanded={isMediaDrawerOpen}
            className={isMediaDrawerOpen ? "is-active" : ""}
            onClick={onToggleMediaDrawer}
            title={isMediaDrawerOpen ? "Hide media" : "Show media"}
            type="button"
          >
            Media
          </button>
        </div>
        <span className="status-light" />
        <TransportPlayheadReadout
          signal={playheadSignal}
          bpm={bpm}
          fps={fps}
          signature={signature}
        />
      </div>

      <div className="timeline-toolbar__controls">
        <div
          className="segmented-control"
          role="tablist"
          aria-label="Timeline scale"
        >
          <button
            className={timelineMode === "musical" ? "is-active" : ""}
            onClick={() =>
              commitProjectPatch("Change timeline scale", {
                timelineMode: "musical",
              })
            }
            type="button"
          >
            Tempo
          </button>
          <button
            className={timelineMode === "timecode" ? "is-active" : ""}
            onClick={() =>
              commitProjectPatch("Change timeline scale", {
                timelineMode: "timecode",
              })
            }
            type="button"
          >
            SMPTE
          </button>
        </div>

        <div
          className="segmented-control"
          role="tablist"
          aria-label="Snap grid"
        >
          {SNAP_OPTIONS.map((option) => (
            <button
              key={option.id}
              className={snapMode === option.id ? "is-active" : ""}
              onClick={() =>
                commitProjectPatch("Change snap grid", {
                  snapMode: option.id,
                })
              }
              type="button"
            >
              {option.id === "auto" && snapMode === "auto"
                ? `${option.label} · ${formatDivision(adaptiveDivision)}`
                : option.label}
            </button>
          ))}
        </div>

        <div className="segmented-control">
          <button
            aria-pressed={snapEnabled}
            className={snapEnabled ? "is-active" : ""}
            onClick={() =>
              commitProjectPatch(
                snapEnabled ? "Disable beat snapping" : "Enable beat snapping",
                { snapEnabled: !snapEnabled },
              )
            }
            title="Shift while dragging a clip or trim handle to temporarily disable snapping."
            type="button"
          >
            {snapEnabled ? "Snap On" : "Snap Off"}
          </button>
        </div>

        <div className="signature-picker">
          <span>Time Sig</span>
          <Select
            aria-label="Time signature"
            onValueChange={(value) =>
              commitProjectPatch("Change time signature", {
                signatureId: value,
              })
            }
            options={SIGNATURE_OPTIONS}
            value={signatureId}
          />
        </div>

        <div className="layer-toolbar">
          <span className="layer-toolbar__count">
            Layers {lanes.length}/{MAX_LAYERS}
          </span>
          <button
            className="layer-toolbar__button"
            disabled={!canCreateLayer}
            onClick={onCreateLayer}
            type="button"
          >
            {canCreateLayer
              ? `Create Layer ${getNextLaneNumber(lanes)}`
              : "Max Layers"}
          </button>
        </div>
      </div>
    </div>
  );
}
