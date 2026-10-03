import { SIGNATURE_OPTIONS } from "../../app/constants.ts";
import type {
  ProjectState,
  TimelineMode,
  TimeSignature,
} from "../../app/types.ts";
import type { PlayheadSignal } from "../../playhead-signal";
import { TransportPlayheadReadout } from "../LivePlayhead";
import { MEDIA_DRAWER_ID } from "../media/MediaDrawer";
import type { MediaDrawerTab } from "../media/media-drawer-model.ts";
import { TempoPill } from "../TempoPill";
import { Select } from "../ui/select";
import "./timeline-toolbar.css";

const MEDIA_DRAWER_SEGMENTS = [
  { tab: "media", label: "Media", subject: "media" },
  { tab: "record", label: "Record", subject: "record inputs" },
] as const;

type TimelineToolbarProps = {
  playheadSignal: PlayheadSignal;
  bpm: number;
  fps: number;
  signature: TimeSignature;
  timelineMode: TimelineMode;
  snapEnabled: boolean;
  signatureId: string;
  commitProjectChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
  commitProjectPatch: (label: string, patch: Partial<ProjectState>) => void;
  isMediaDrawerOpen: boolean;
  mediaDrawerTab: MediaDrawerTab;
  onSelectMediaDrawerTab: (tab: MediaDrawerTab) => void;
};

// The Media drawer's Media | Record switch, the playhead readout and the
// timeline's scale, snap, tempo and time signature controls above the
// timeline.
export function TimelineToolbar({
  playheadSignal,
  bpm,
  fps,
  signature,
  timelineMode,
  snapEnabled,
  signatureId,
  commitProjectChange,
  commitProjectPatch,
  isMediaDrawerOpen,
  mediaDrawerTab,
  onSelectMediaDrawerTab,
}: TimelineToolbarProps) {
  return (
    <div className="timeline-toolbar">
      <div className="timeline-toolbar__display">
        {/* A segment opens the drawer on its tab, or closes it when active. */}
        <div aria-label="Media drawer" className="segmented-control" role="group">
          {MEDIA_DRAWER_SEGMENTS.map((segment) => {
            const active = isMediaDrawerOpen && mediaDrawerTab === segment.tab;
            return (
              <button
                aria-controls={MEDIA_DRAWER_ID}
                aria-expanded={active}
                className={active ? "is-active" : ""}
                key={segment.tab}
                onClick={() => onSelectMediaDrawerTab(segment.tab)}
                title={`${active ? "Hide" : "Show"} ${segment.subject}`}
                type="button"
              >
                {segment.label}
              </button>
            );
          })}
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
            Time
          </button>
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

        <TempoPill bpm={bpm} commitProjectChange={commitProjectChange} />

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
      </div>
    </div>
  );
}
