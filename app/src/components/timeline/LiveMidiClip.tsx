import { useSyncExternalStore } from "react";
import { formatDuration } from "../../app/format.ts";
import { secondsToQuarters } from "../../app/timeline-math.ts";
import type { LiveMidiTake } from "../../hooks/useRecording.ts";
import { MidiClipThumbnail } from "./MidiClipThumbnail";
import "./live-recording-clip.css";

// The MIDI clip a track is recording into, from where it starts to the
// playhead: each note in place as it's played, a held one growing with the
// clip, with the red REC badge video and audio takes have.
export function LiveMidiClip({
  take,
  bpm,
  quarterPx,
}: {
  take: LiveMidiTake;
  bpm: number;
  quarterPx: number;
}) {
  const { store, midi } = take;
  const durationSeconds = useSyncExternalStore(store.subscribe, () =>
    store.durationSeconds(take.trackId),
  );
  useSyncExternalStore(midi.subscribe, midi.getVersion);
  const lengthQ = secondsToQuarters(durationSeconds, bpm);
  return (
    <div
      aria-label={`Recording MIDI, ${formatDuration(durationSeconds)}`}
      className={`live-recording-clip live-recording-clip--midi ${take.ended ? "live-recording-clip--ended" : ""}`}
      data-live-recording-track-id={take.trackId}
      role="img"
      style={{ left: take.startQ * quarterPx, width: Math.max(2, lengthQ * quarterPx) }}
    >
      <MidiClipThumbnail
        lengthQ={lengthQ}
        notes={midi.shownNotes()}
        trimStartQ={0}
      />
      <div className="live-recording-clip__body">
        <span className="live-recording-clip__badge">REC</span>
        <small>{formatDuration(durationSeconds)}</small>
      </div>
    </div>
  );
}
