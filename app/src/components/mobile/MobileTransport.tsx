import {
  ArrowPathRoundedSquareIcon,
  BackwardIcon,
  PauseIcon,
  PlayIcon,
} from "@heroicons/react/24/solid";
import type { MasterMeterTap } from "../../fx-shaders/audio-bands";
import type { PlayheadSignal } from "../../playhead-signal";
import type { StatusPlayheadState } from "../../status-items";
import { StatusPlayhead } from "../StatusPlayhead";
import { RecordIcon } from "../timeline/RecordIcon";
import { VuMeter } from "../timeline/VuMeter";

type MobileTransportProps = Omit<StatusPlayheadState, "playheadQ"> & {
  playheadSignal: PlayheadSignal;
  getMeterTap: () => MasterMeterTap | null;
  isPlaying: boolean;
  isRecording: boolean;
  isLooping: boolean;
  onSkipToStart: () => void;
  onTogglePlay: () => void;
  onRecord: () => void;
  onToggleLoop: () => void;
  onToggleTimelineMode: () => void;
};

// The mobile shell's thin transport under the preview: back to the start,
// Play, Record, the playhead's position and the loop switch, with the
// master VU meter in a strip below them. Tapping the position swaps it
// between bars and timecode.
export function MobileTransport({
  playheadSignal,
  getMeterTap,
  isPlaying,
  isRecording,
  isLooping,
  onSkipToStart,
  onTogglePlay,
  onRecord,
  onToggleLoop,
  onToggleTimelineMode,
  ...readout
}: MobileTransportProps) {
  return (
    <div className="mobile-transport">
      <button
        aria-label="Jump to start"
        className="mobile-icon-button"
        onClick={onSkipToStart}
        type="button"
      >
        <BackwardIcon aria-hidden="true" />
      </button>
      <button
        aria-label={isPlaying ? "Pause" : "Play"}
        aria-pressed={isPlaying}
        className="mobile-icon-button mobile-transport__play"
        onClick={onTogglePlay}
        type="button"
      >
        {isPlaying ? (
          <PauseIcon aria-hidden="true" />
        ) : (
          <PlayIcon aria-hidden="true" />
        )}
      </button>
      <button
        aria-label={isRecording ? "Stop recording" : "Record"}
        aria-pressed={isRecording}
        className="mobile-icon-button mobile-transport__record"
        onClick={onRecord}
        type="button"
      >
        <RecordIcon />
      </button>
      <button
        aria-label={
          readout.timelineMode === "musical"
            ? "Playhead, show timecode"
            : "Playhead, show bars and beats"
        }
        className="mobile-transport__position"
        onClick={onToggleTimelineMode}
        type="button"
      >
        <StatusPlayhead signal={playheadSignal} {...readout} />
      </button>
      <button
        aria-label="Loop"
        aria-pressed={isLooping}
        className="mobile-icon-button mobile-transport__loop"
        onClick={onToggleLoop}
        type="button"
      >
        <ArrowPathRoundedSquareIcon aria-hidden="true" />
      </button>
      <VuMeter getMeterTap={getMeterTap} isPlaying={isPlaying} />
    </div>
  );
}
