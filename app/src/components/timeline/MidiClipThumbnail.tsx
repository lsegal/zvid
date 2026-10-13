import { memo } from "react";
import type { MidiNote } from "../../midi-clip.ts";
import {
  type MidiClipTimeline,
  performMidiNotes,
} from "../../midi-clip-timeline.ts";
import { thumbnailNotes } from "../../midi-piano-roll.ts";

type MidiClipThumbnailProps = {
  notes: readonly MidiNote[];
  // The clip's window: from `trimStartQ` quarters into its notes, `lengthQ`
  // quarters long.
  trimStartQ: number;
  lengthQ: number;
  // Its loop and Start marker, which the thumbnail plays out like the mix.
  timeline?: MidiClipTimeline;
};

// A MIDI clip's piano-roll thumbnail in its source-track lane, where an
// audio clip draws its waveform: a bar for each note in the clip's window,
// higher notes higher up, its loop repeated as it plays.
export const MidiClipThumbnail = memo(function MidiClipThumbnail({
  notes,
  trimStartQ,
  lengthQ,
  timeline,
}: MidiClipThumbnailProps) {
  const played = performMidiNotes(notes, timeline, trimStartQ + lengthQ);
  return (
    <span aria-hidden="true" className="source-span__midi" data-midi-thumbnail>
      {thumbnailNotes(played, trimStartQ, lengthQ).map((bar, index) => (
        <span
          // Notes have no ids; their order is stable while they draw.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={index}
          className="source-span__midi-note"
          style={{
            left: `${bar.left * 100}%`,
            width: `${bar.width * 100}%`,
            top: `${bar.top * 100}%`,
            height: `${bar.height * 100}%`,
          }}
        />
      ))}
    </span>
  );
});
