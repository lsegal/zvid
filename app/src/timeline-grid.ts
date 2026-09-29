// Adaptive timeline grid: note-value divisions (1/1 to 1/32) that get finer
// as the timeline zooms in and coarser as it zooms out, like a DAW grid.

export type SnapMode = "auto" | "bar" | "beat" | "half" | "quarter";

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

export function formatDivision(division: GridDivision) {
  return `1/${division}`;
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

export function getSnapUnit(
  mode: SnapMode,
  signature: GridSignature,
  adaptiveDivision: GridDivision,
) {
  const beatUnit = 4 / signature.denominator;
  const barLength = signature.numerator * beatUnit;
  switch (mode) {
    case "auto":
      return divisionQuarters(adaptiveDivision);
    case "bar":
      return barLength;
    case "beat":
      return beatUnit;
    case "half":
      return beatUnit / 2;
    case "quarter":
      return beatUnit / 4;
    default:
      return beatUnit;
  }
}

// The spacing the grid draws at: the adaptive division, but never coarser
// than the snap unit, so every snap point stays visible.
export function getGridUnit(snapUnit: number, adaptiveDivision: GridDivision) {
  return Math.min(snapUnit, divisionQuarters(adaptiveDivision));
}

// Line layers from faintest to strongest. Beat lines only draw when the grid
// is at least as fine as a beat; bar lines always draw.
export function getGridLayers(
  gridUnit: number,
  signature: GridSignature,
): GridLayer[] {
  const beatUnit = 4 / signature.denominator;
  const barLength = signature.numerator * beatUnit;
  const layers: GridLayer[] = [];
  if (gridUnit < barLength && Math.abs(gridUnit - beatUnit) > 1e-9) {
    layers.push({ spacingQ: gridUnit, weight: "division" });
  }
  if (gridUnit <= beatUnit && beatUnit < barLength) {
    layers.push({ spacingQ: beatUnit, weight: "beat" });
  }
  layers.push({ spacingQ: barLength, weight: "bar" });
  return layers;
}
