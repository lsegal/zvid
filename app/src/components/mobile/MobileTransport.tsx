import {
  ArrowPathRoundedSquareIcon,
  BackwardIcon,
  PauseIcon,
  PlayIcon,
} from "@heroicons/react/24/solid";
import type { PlayheadSignal } from "../../playhead-signal";
import type { StatusPlayheadState } from "../../status-items";
import { StatusPlayhead } from "../StatusPlayhead";
import { RecordIcon } from "../timeline/RecordIcon";

type MobileTransportProps = Omit<StatusPlayheadState, "playheadQ"> & {
  playheadSignal: PlayheadSignal;
  isPlaying: boolean;
  isRecording: boolean;
  isLooping: boolean;
  onSkipToStart: () => void;
  onTogglePlay: () => void;
  onRecord: () => void;
  onToggleLoop: () => void;
};

// The mobile shell's thin transport under the preview: back to the start,
// Play, Record, the playhead's position and the loop switch.
export function MobileTransport({
  playheadSignal,
  isPlaying,
  isRecording,
  isLooping,
  onSkipToStart,
  onTogglePlay,
  onRecord,
  onToggleLoop,
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
      <output aria-label="Playhead" className="mobile-transport__position">
        <StatusPlayhead signal={playheadSignal} {...readout} />
      </output>
      <button
        aria-label="Loop"
        aria-pressed={isLooping}
        className="mobile-icon-button mobile-transport__loop"
        onClick={onToggleLoop}
        type="button"
      >
        <ArrowPathRoundedSquareIcon aria-hidden="true" />
      </button>
    </div>
  );
}
