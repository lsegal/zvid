import {
  MIDI_TIMELINE_MIN_Q,
  type MidiTimelineField,
  midiTimelineEnd,
  setMidiTimelineField,
  setMidiTimelineLoop,
} from "../midi-clip-timeline.ts";
import { midiHistoryLabels } from "../midi-editing.ts";
import type { MidiClipModel } from "../midi-panel-model.ts";
import type { TimeValueFormat, TimeValueRange } from "../time-value.ts";
import type { SetMidiClipTimeline } from "./midi/PianoRoll";
import { TimeValueControl } from "./ui/TimeValueControl";

type MidiClipTimelineFieldsProps = {
  midiClip: MidiClipModel;
  format: TimeValueFormat;
  accent: string;
  onSetTimeline: SetMidiClipTimeline;
};

const FIELDS: readonly MidiTimelineField[] = [
  "length",
  "start",
  "loopStart",
  "loopEnd",
];

export const MIDI_TIMELINE_FIELD_LABELS: Record<MidiTimelineField, string> = {
  length: "MIDI Length",
  start: "Start Marker",
  loopStart: "Loop Start",
  loopEnd: "Loop End",
};

// A MIDI clip's Length, Loop switch, loop brace and Start marker in Clip
// properties, in bars.beats whatever the timeline shows, as Live does. A
// drag or held arrow key previews the edit and its commit is one undo step.
export function MidiClipTimelineFields({
  midiClip,
  format,
  accent,
  onSetTimeline,
}: MidiClipTimelineFieldsProps) {
  const { spanId, timeline } = midiClip;
  const musical: TimeValueFormat = { ...format, timelineMode: "musical" };
  const limits: Record<MidiTimelineField, TimeValueRange> = {
    length: { min: MIDI_TIMELINE_MIN_Q, max: Number.POSITIVE_INFINITY },
    start: { min: 0, max: midiTimelineEnd(timeline) - MIDI_TIMELINE_MIN_Q },
    loopStart: { min: 0, max: timeline.loopEnd - MIDI_TIMELINE_MIN_Q },
    loopEnd: {
      min: timeline.loopStart + MIDI_TIMELINE_MIN_Q,
      max: Number.POSITIVE_INFINITY,
    },
  };

  return (
    <div className="source-clip-properties__fields" data-midi-timeline-fields>
      <fieldset className="fx-segmented">
        <legend>Loop</legend>
        <div className="fx-segmented__options">
          {[false, true].map((loop) => (
            <button
              aria-pressed={timeline.loop === loop}
              key={String(loop)}
              onClick={() => {
                if (timeline.loop !== loop) {
                  onSetTimeline(
                    spanId,
                    setMidiTimelineLoop(timeline, loop),
                    midiHistoryLabels.loop(loop),
                  );
                }
              }}
              type="button"
            >
              {loop ? "On" : "Off"}
            </button>
          ))}
        </div>
      </fieldset>
      {FIELDS.map((field) => (
        <TimeValueControl
          key={field}
          {...musical}
          accent={accent}
          kind={field === "length" ? "duration" : "position"}
          label={MIDI_TIMELINE_FIELD_LABELS[field]}
          max={limits[field].max}
          min={limits[field].min}
          onChange={(value, { commit }) =>
            onSetTimeline(
              spanId,
              setMidiTimelineField(timeline, field, value),
              midiHistoryLabels.timeline[field],
              commit ? "commit" : "transient",
            )
          }
          value={timeline[field]}
        />
      ))}
    </div>
  );
}
