import type { TimeSignature } from "./app/types.ts";

// A typed signature's numerator and denominator stay within this range, so
// a typo such as 4/400 can't shrink a bar to a sliver or stretch it across
// the whole session.
export const SIGNATURE_PART_MAX = 99;

// The denominators the signature ladder offers for each numerator,
// including the nonstandard /3, /5 and /7.
export const SIGNATURE_LADDER_DENOMINATORS = [1, 2, 3, 4, 5, 7, 8] as const;

export const SIGNATURE_LADDER_NUMERATOR_MAX = 12;

export const DEFAULT_SIGNATURE: TimeSignature = {
  id: "4/4",
  numerator: 4,
  denominator: 4,
};

function makeSignature(numerator: number, denominator: number) {
  return { id: `${numerator}/${denominator}`, numerator, denominator };
}

// The signatures the picker's -/+ buttons step between, like the zoom
// ladder: by numerator from 1 to 12, then by denominator, so 3/3 steps up
// to 3/4 and on to 3/5.
export const SIGNATURE_LADDER: readonly TimeSignature[] = Array.from(
  { length: SIGNATURE_LADDER_NUMERATOR_MAX },
  (_, index) =>
    SIGNATURE_LADDER_DENOMINATORS.map((denominator) =>
      makeSignature(index + 1, denominator),
    ),
).flat();

const SIGNATURE_PATTERN = /^\s*(\d+)\s*\/\s*(\d+)\s*$/;

// Parses a signature typed or stored as "N/M", or null when it isn't one.
// The id is normalized, so " 07 / 5" gives "7/5".
export function parseSignature(text: string): TimeSignature | null {
  const match = SIGNATURE_PATTERN.exec(text);
  if (!match) {
    return null;
  }
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  const inRange = (part: number) => part >= 1 && part <= SIGNATURE_PART_MAX;
  if (!inRange(numerator) || !inRange(denominator)) {
    return null;
  }
  return makeSignature(numerator, denominator);
}

// Resolved signatures are cached so one id always gives the same object,
// which keeps memoized grid and ruler work from rerunning on every render.
const resolvedSignatures = new Map<string, TimeSignature>([
  [DEFAULT_SIGNATURE.id, DEFAULT_SIGNATURE],
]);

// The signature `signatureId` names, or 4/4 when it doesn't parse.
export function signatureById(signatureId: string) {
  let signature = resolvedSignatures.get(signatureId);
  if (!signature) {
    signature = parseSignature(signatureId) ?? DEFAULT_SIGNATURE;
    resolvedSignatures.set(signatureId, signature);
  }
  return signature;
}

function ladderOrder(a: TimeSignature, b: TimeSignature) {
  return a.numerator - b.numerator || a.denominator - b.denominator;
}

// The next ladder signature in the given direction, or null past either end.
// A custom signature between two rungs, such as 3/6, steps to the nearer
// rung on that side: 3/7 up and 3/5 down.
export function stepSignature(signature: TimeSignature, direction: 1 | -1) {
  const next =
    direction > 0
      ? SIGNATURE_LADDER.find((rung) => ladderOrder(rung, signature) > 0)
      : SIGNATURE_LADDER.findLast((rung) => ladderOrder(rung, signature) < 0);
  return next ?? null;
}

// How much longer a beat is than the power-of-two note nearest it: 4/3 for
// a third note, 4/5 for a fifth and 8/7 for a seventh, and 1 for the usual
// /2, /4 and /8. Scaling the grid's note divisions by it keeps snapping on
// beats and bar lines for any denominator.
export function signatureBeatScale(signature: TimeSignature) {
  const beatUnit = 4 / signature.denominator;
  return beatUnit / 2 ** Math.round(Math.log2(beatUnit));
}
