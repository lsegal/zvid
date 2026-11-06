// The grid recorded MIDI notes snap to: Off, or straight and triplet values
// from a quarter note down to a thirty-second.
export const RECORD_QUANTIZE_VALUES = [
  "off",
  "1/4",
  "1/4T",
  "1/8",
  "1/8T",
  "1/16",
  "1/16T",
  "1/32",
  "1/32T",
] as const;

export type RecordQuantize = (typeof RECORD_QUANTIZE_VALUES)[number];

const STRAIGHT_STEPS_PER_Q: Readonly<Record<string, number>> = {
  "1/4": 1,
  "1/8": 2,
  "1/16": 4,
  "1/32": 8,
};

// A grid's divisions per quarter note, which stay whole for triplets where
// their steps in quarters don't; 0 for Off.
function divisionsPerQ(quantize: RecordQuantize) {
  if (quantize === "off") {
    return 0;
  }
  return quantize.endsWith("T")
    ? (STRAIGHT_STEPS_PER_Q[quantize.slice(0, -1)] ?? 0) * 1.5
    : (STRAIGHT_STEPS_PER_Q[quantize] ?? 0);
}

export function isRecordQuantize(value: unknown): value is RecordQuantize {
  return RECORD_QUANTIZE_VALUES.includes(value as RecordQuantize);
}

export function recordQuantizeLabel(quantize: RecordQuantize) {
  return quantize === "off" ? "Off" : quantize;
}

/** The quarter of `quantize`'s grid nearest `q`; `q` itself with Off. */
export function quantizeQ(q: number, quantize: RecordQuantize) {
  const divisions = divisionsPerQ(quantize);
  return divisions ? Math.round(q * divisions) / divisions : q;
}

/** The last quarter of `quantize`'s grid at or before `q`; `q` with Off. */
export function quantizeFloorQ(q: number, quantize: RecordQuantize) {
  const divisions = divisionsPerQ(quantize);
  return divisions ? Math.floor(q * divisions + 1e-9) / divisions : q;
}
