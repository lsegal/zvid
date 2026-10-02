// Note values for tempo-synced audio effects (synced delays, LFO rates):
// "1/32" … "1/1", "1 bar", "2 bars" and "4 bars", each straight, dotted
// ("1/8D") or triplet ("1/8T"). A quarter note is one beat at the session
// BPM; a bar is the time signature's length.
import type { AudioTempo } from "./processor.ts";

export type NoteFeel = "straight" | "dotted" | "triplet";

const NOTE_FRACTIONS = ["1/32", "1/16", "1/8", "1/4", "1/2", "1/1"] as const;
const BAR_COUNTS = ["1 bar", "2 bars", "4 bars"] as const;

// The straight values, shortest first.
export const NOTE_VALUES: readonly string[] = [
  ...NOTE_FRACTIONS,
  ...BAR_COUNTS,
];

const FEEL_SUFFIX: Record<NoteFeel, string> = {
  straight: "",
  dotted: "D",
  triplet: "T",
};

const FEEL_FACTOR: Record<NoteFeel, number> = {
  straight: 1,
  dotted: 1.5,
  triplet: 2 / 3,
};

// The option for `value` (from NOTE_VALUES) at `feel`, such as "1/8D".
export function noteValueOption(value: string, feel: NoteFeel = "straight") {
  return `${value}${FEEL_SUFFIX[feel]}`;
}

// Every straight, dotted and triplet value, shortest straight value first.
export const NOTE_VALUE_OPTIONS: readonly string[] = NOTE_VALUES.flatMap(
  (value) => [
    noteValueOption(value),
    noteValueOption(value, "dotted"),
    noteValueOption(value, "triplet"),
  ],
);

function parseNoteValue(option: string) {
  const trimmed = option.trim();
  const suffix = trimmed.at(-1);
  const feel: NoteFeel =
    suffix === "D" ? "dotted" : suffix === "T" ? "triplet" : "straight";
  const base = feel === "straight" ? trimmed : trimmed.slice(0, -1);
  if (!NOTE_VALUES.includes(base)) {
    return undefined;
  }
  // "2 bars" counts bars; "1/8" divides a whole note.
  const [count, unit] = base.split(/[ /]/).map(Number);
  return base.includes("bar")
    ? { bars: count, quarters: 0, feel }
    : { bars: 0, quarters: 4 / unit, feel };
}

// Quarter notes in one bar of `signature`.
export function quartersPerBar({ signature }: Pick<AudioTempo, "signature">) {
  return (signature.numerator * 4) / signature.denominator;
}

// The length of `option` (such as "1/8T" or "2 bars") in seconds at
// `tempo`, or undefined when it names no note value.
export function noteValueSeconds(option: string, tempo: AudioTempo) {
  const parsed = parseNoteValue(option);
  if (!parsed || !(tempo.bpm > 0)) {
    return undefined;
  }
  const quarters = parsed.bars * quartersPerBar(tempo) + parsed.quarters;
  return ((quarters * 60) / tempo.bpm) * FEEL_FACTOR[parsed.feel];
}

// Where timeline second `seconds` falls in a cycle of `periodSeconds`
// starting at the timeline's start, from 0 up to 1, so a synced LFO has the
// same phase at the same timeline time however playback got there.
export function timelinePhase(seconds: number, periodSeconds: number) {
  if (!(periodSeconds > 0)) {
    return 0;
  }
  const cycles = seconds / periodSeconds;
  return cycles - Math.floor(cycles);
}
