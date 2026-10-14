// The Arpeggiator effect: a MIDI effect that turns a MIDI clip's held
// chords into notes played one at a time on the beat grid (see
// note-generators.ts), ahead of the clip's Synth.
import {
  ARP_MAX_OCTAVES,
  ARP_PATTERNS,
  ARP_RATES,
  type Arpeggiator,
  type ArpPattern,
  type ArpRate,
  DEFAULT_ARPEGGIATOR,
} from "../../../note-generators.ts";

export const ARPEGGIATOR_EFFECT_NAME = "Arpeggiator";

export const RATE_KEY = "Rate";
export const PATTERN_KEY = "Pattern";
export const OCTAVES_KEY = "Octaves";

const RATE_LABELS: Record<ArpRate, string> = {
  1: "1/4",
  0.5: "1/8",
  0.25: "1/16",
  0.125: "1/32",
};

const PATTERN_LABELS: Record<ArpPattern, string> = {
  up: "Up",
  down: "Down",
  "up-down": "Up-Down",
  random: "Random",
};

export const RATE_OPTIONS = ARP_RATES.map((rate) => RATE_LABELS[rate]);
export const PATTERN_OPTIONS = ARP_PATTERNS.map(
  (pattern) => PATTERN_LABELS[pattern],
);
export const MAX_OCTAVES = ARP_MAX_OCTAVES;

/** The Rate option that steps every `rate` quarters. */
export function rateOption(rate: ArpRate) {
  return RATE_LABELS[rate];
}

/** The Pattern option that plays `pattern`. */
export function patternOption(pattern: ArpPattern) {
  return PATTERN_LABELS[pattern];
}

export function isArpeggiatorEffectName(effectName: string) {
  return effectName === ARPEGGIATOR_EFFECT_NAME;
}

type ArpeggiatorParameter = {
  key: string;
  value: string;
  numericValue?: number;
};

/**
 * The arpeggiator an Arpeggiator effect's stored `parameters` play, any
 * missing or invalid setting taking its default. `enabled` is the effect's
 * own switch.
 */
export function readArpeggiatorEffect(
  parameters: readonly ArpeggiatorParameter[],
  enabled = true,
): Arpeggiator {
  const read = (key: string) =>
    parameters.find((parameter) => parameter.key === key);
  const rate = ARP_RATES.find(
    (candidate) => RATE_LABELS[candidate] === read(RATE_KEY)?.value,
  );
  const pattern = ARP_PATTERNS.find(
    (candidate) => PATTERN_LABELS[candidate] === read(PATTERN_KEY)?.value,
  );
  const stored = read(OCTAVES_KEY);
  const octaves =
    stored?.numericValue ??
    (stored ? Number.parseFloat(stored.value) : Number.NaN);
  return {
    kind: "arpeggiator",
    enabled,
    rate: rate ?? DEFAULT_ARPEGGIATOR.rate,
    pattern: pattern ?? DEFAULT_ARPEGGIATOR.pattern,
    octaves: Number.isFinite(octaves)
      ? Math.min(MAX_OCTAVES, Math.max(1, Math.round(octaves)))
      : DEFAULT_ARPEGGIATOR.octaves,
  };
}
