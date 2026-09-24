// Playhead position formatting shared by the timeline toolbar and the status
// bar.

export type MeterSignature = {
  numerator: number;
  denominator: number;
};

// `72.5` seconds at 30 fps -> `01:12:15` (minutes:seconds:frames).
export function formatTimecode(seconds: number, fps = 30) {
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = Math.floor(seconds % 60);
  const frames = Math.floor(((seconds % 1) + Number.EPSILON) * fps);
  return `${minutes.toString().padStart(2, "0")}:${remainderSeconds
    .toString()
    .padStart(2, "0")}:${frames.toString().padStart(2, "0")}`;
}

// Quarter notes -> `bar.beat.sixteenth`, all 1-based.
export function formatMusicalPosition(
  quarters: number,
  signature: MeterSignature,
) {
  const beatUnit = 4 / signature.denominator;
  const barLength = signature.numerator * beatUnit;
  const safeQuarter = Math.max(0, quarters);
  const bar = Math.floor(safeQuarter / barLength);
  const barOffset = safeQuarter - bar * barLength;
  const beat = Math.floor(barOffset / beatUnit);
  const subdivision = Math.floor(
    (barOffset - beat * beatUnit) / (beatUnit / 4),
  );
  return `${bar + 1}.${beat + 1}.${subdivision + 1}`;
}
