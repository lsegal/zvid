// The Drum Rack effect: an instrument a MIDI clip can play its notes
// through instead of the Synth, each of its 16 pads playing a one-shot
// drum sample (see audio-mix/drum-rack.ts). Its bank fills every pad, and
// any pad can play a sample from the media library instead. It is a MIDI
// effect, so only MIDI clips' stacks offer it.
import {
  DEFAULT_DRUM_BANK,
  DRUM_PAD_COUNT,
  type DrumBank,
  findDrumBank,
} from "./banks.ts";

export const DRUM_RACK_EFFECT_NAME = "Drum Rack";
// The parameter holding the rack's bank and its pads' own samples.
export const DRUM_RACK_KEY = "Pads";

export function isDrumRackEffectName(effectName: string) {
  return effectName === DRUM_RACK_EFFECT_NAME;
}

/**
 * What a Drum Rack plays: a bundled bank, by id, and for each pad, pad 1
 * first, the media path of a sample it plays instead of its bank's, if
 * any.
 */
export type DrumRackSettings = {
  bank: string;
  pads: readonly (string | undefined)[];
};

export const DEFAULT_DRUM_RACK: DrumRackSettings = {
  bank: DEFAULT_DRUM_BANK.id,
  pads: Array.from({ length: DRUM_PAD_COUNT }, () => undefined),
};

/**
 * The settings a stored Drum Rack value holds: `{"bank": id, "pads":
 * {"<pad number>": media path}}`. An unknown bank plays the default one,
 * and pads outside the rack or without a path are dropped.
 */
export function parseDrumRack(value: string | undefined): DrumRackSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value ?? "");
  } catch {
    return DEFAULT_DRUM_RACK;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return DEFAULT_DRUM_RACK;
  }
  const record = parsed as { bank?: unknown; pads?: unknown };
  const bank =
    findDrumBank(typeof record.bank === "string" ? record.bank : undefined) ??
    DEFAULT_DRUM_BANK;
  const stored =
    record.pads &&
    typeof record.pads === "object" &&
    !Array.isArray(record.pads)
      ? (record.pads as Record<string, unknown>)
      : {};
  const pads = DEFAULT_DRUM_RACK.pads.map((_, pad) => {
    const path = stored[String(pad + 1)];
    return typeof path === "string" && path.trim() ? path.trim() : undefined;
  });
  return { bank: bank.id, pads };
}

/** `settings` as the Drum Rack stores them (see parseDrumRack). */
export function formatDrumRack(settings: DrumRackSettings) {
  const pads: Record<string, string> = {};
  settings.pads.forEach((path, pad) => {
    if (path) {
      pads[String(pad + 1)] = path;
    }
  });
  return JSON.stringify({ bank: settings.bank, pads });
}

export const DEFAULT_DRUM_RACK_VALUE = formatDrumRack(DEFAULT_DRUM_RACK);

/** `settings` playing `bank`, every pad playing its sample from it. */
export function withDrumBank(
  settings: DrumRackSettings,
  bank: DrumBank,
): DrumRackSettings {
  return { ...settings, bank: bank.id, pads: DEFAULT_DRUM_RACK.pads };
}

/** `settings` with `pad` playing the media at `path`, or its bank's sample. */
export function withDrumPad(
  settings: DrumRackSettings,
  pad: number,
  path: string | undefined,
): DrumRackSettings {
  return {
    ...settings,
    pads: settings.pads.map((current, index) =>
      index === pad ? path : current,
    ),
  };
}

/** The bank `settings` play. */
export function drumRackBank(settings: DrumRackSettings) {
  return findDrumBank(settings.bank) ?? DEFAULT_DRUM_BANK;
}

/** A pad's own sample's name: its media's file name. */
export function drumPadFileName(path: string) {
  return path.split(/[/\\]/).pop() ?? path;
}

type DrumRackParameter = { key: string; value: string };

/** The settings a Drum Rack effect's stored `parameters` play. */
export function readDrumRackEffect(
  parameters: readonly DrumRackParameter[],
): DrumRackSettings {
  return parseDrumRack(
    parameters.find((parameter) => parameter.key === DRUM_RACK_KEY)?.value,
  );
}
