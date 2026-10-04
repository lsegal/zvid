// Adaptive timeline grid: note-value divisions (1/1 to 1/32) that get finer
// as the timeline zooms in and coarser as it zooms out, like a DAW grid.

// The denominator of a note value: 4 is a quarter note, 16 a sixteenth.
export type GridDivision = 1 | 2 | 4 | 8 | 16 | 32;

export type GridSignature = { numerator: number; denominator: number };

export type GridLineWeight = "bar" | "beat" | "division";

export type GridLayer = { spacingQ: number; weight: GridLineWeight };

// Grid lines closer than this merge into noise, so the grid gets coarser.
export const GRID_MIN_PX = 5;
// Grid lines further apart than this leave room for a finer division.
export const GRID_MAX_PX = 20;
export const GRID_FINEST: GridDivision = 32;
export const GRID_COARSEST: GridDivision = 1;
const GRID_START: GridDivision = 4;

// Length of one division in quarter notes; a whole note is four quarters.
export function divisionQuarters(division: GridDivision) {
  return 4 / division;
}

// Picks the division for the zoom. Starting from the previous division gives
// hysteresis: any division spaced between the two thresholds is kept, and one
// step never crosses the other threshold because the band spans more than 2x.
export function resolveAdaptiveDivision(
  quarterPx: number,
  previousDivision: GridDivision = GRID_START,
): GridDivision {
  if (!Number.isFinite(quarterPx) || quarterPx <= 0) {
    return previousDivision;
  }

  const spacingPx = (division: number) => (4 / division) * quarterPx;
  let division: number = previousDivision;
  while (spacingPx(division) > GRID_MAX_PX && division < GRID_FINEST) {
    division *= 2;
  }
  while (spacingPx(division) < GRID_MIN_PX && division > GRID_COARSEST) {
    division /= 2;
  }
  return division as GridDivision;
}

// The smallest power-of-two number of bars that spans at least `minPx`, so
// lines or labels a bar apart thin out to every 2, 4, 8... bars when zoomed
// far out.
export function getBarStep(barPx: number, minPx: number) {
  if (!Number.isFinite(barPx) || barPx <= 0) {
    return 1;
  }

  let step = 1;
  while (step * barPx < minPx) {
    step *= 2;
  }
  return step;
}

// The ruler's bar lines from `startPx` to `endPx` of the timeline, so a long
// session renders only the bars near the view. A label sits to the right of
// its line, so the range should reach a little left of the view. An empty
// range, before the view is measured, gives every bar.
export function getRulerBars(
  barLength: number,
  totalQuarters: number,
  quarterPx: number,
  startPx: number,
  endPx: number,
) {
  const barCount = Math.ceil(totalQuarters / barLength);
  const barPx = barLength * quarterPx;
  const visible = endPx > startPx && barPx > 0;
  const first = visible ? Math.max(0, Math.floor(startPx / barPx)) : 0;
  const last = visible
    ? Math.min(barCount, Math.ceil(endPx / barPx) + 1)
    : barCount;
  const bars: Array<{ index: number; quarter: number }> = [];
  for (let index = first; index < last; index++) {
    bars.push({ index, quarter: index * barLength });
  }
  return bars;
}

// How far apart ruler labels must start so they don't overlap: a bar number
// such as "128", or a timecode such as "01:23:15".
export const RULER_LABEL_MIN_PX = { musical: 40, timecode: 80 } as const;

// Line layers from faintest to strongest. Beat lines only draw when the grid
// is at least as fine as a beat; bar lines always draw. Given the width of a
// quarter, layers spaced closer than GRID_MIN_PX are dropped and bar lines
// thin to multiples of bars. This only thins what is drawn: snapping keeps
// the adaptive division, so it can snap between the drawn lines.
export function getGridLayers(
  gridUnit: number,
  signature: GridSignature,
  quarterPx = Number.POSITIVE_INFINITY,
): GridLayer[] {
  const beatUnit = 4 / signature.denominator;
  const barLength = signature.numerator * beatUnit;
  const isVisible = (spacingQ: number) => spacingQ * quarterPx >= GRID_MIN_PX;
  const layers: GridLayer[] = [];
  if (
    gridUnit < barLength &&
    Math.abs(gridUnit - beatUnit) > 1e-9 &&
    isVisible(gridUnit)
  ) {
    layers.push({ spacingQ: gridUnit, weight: "division" });
  }
  if (gridUnit <= beatUnit && beatUnit < barLength && isVisible(beatUnit)) {
    layers.push({ spacingQ: beatUnit, weight: "beat" });
  }
  layers.push({
    spacingQ: barLength * getBarStep(barLength * quarterPx, GRID_MIN_PX),
    weight: "bar",
  });
  return layers;
}
