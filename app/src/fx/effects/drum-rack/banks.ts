// The drum banks that ship with the app, listed in the Drum Rack's bank
// menu. Each bank fills the rack's 16 pads with one drum machine's sounds.
// Their `.wav` files live in public/drum-banks/<bank>/ and are written by
// scripts/gen-drum-banks.mjs, which synthesizes every sound, so none comes
// from a third-party sample pack. The app fetches a bank's files only when
// a rack plays, auditions or shows that bank, never at startup. A session
// stores a bank by its id: never rename or reuse an id.

/** How many pads a Drum Rack has, in a 4x4 grid. */
export const DRUM_PAD_COUNT = 16;

/**
 * The MIDI note pad 1 plays; pad N plays the note N - 1 above it, so the
 * pads follow General MIDI's drum map from Bass Drum 1 (36) to Ride
 * Cymbal 1 (51), as hardware pads and other DAWs' drum racks do.
 */
export const FIRST_PAD_NOTE = 36;

export type DrumBankPad = {
  /** Name shown on the pad. */
  name: string;
  /** File name in the bank's folder under public/drum-banks/. */
  file: string;
};

export type DrumBank = {
  /** Stable id stored in sessions, `builtin:<slug>`. */
  id: string;
  /** Name shown in the bank menu. */
  name: string;
  /** Folder name under public/drum-banks/. */
  slug: string;
  /** The 16 pads, pad 1 first. */
  pads: readonly DrumBankPad[];
};

function bank(slug: string, name: string, padNames: readonly string[]) {
  if (padNames.length !== DRUM_PAD_COUNT) {
    throw new Error(`Drum bank ${slug} needs ${DRUM_PAD_COUNT} pads.`);
  }
  const pads = padNames.map((padName, index) => ({
    name: padName,
    file: `${String(index + 1).padStart(2, "0")}-${padName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")}.wav`,
  }));
  return { id: `builtin:${slug}`, name, slug, pads };
}

// Each list follows the General MIDI slots from note 36: kick, rim, snare,
// clap, second snare, low tom, closed hat, second low tom, pedal hat, mid
// tom, open hat, second mid tom, high tom, crash, second high tom, ride.
// A machine without a sound for a slot fills it with its nearest one.
export const DRUM_BANKS: readonly DrumBank[] = [
  bank("tr-808", "TR-808", [
    "Kick",
    "Rimshot",
    "Snare",
    "Clap",
    "Snare Snappy",
    "Low Tom",
    "Closed Hat",
    "Low Conga",
    "Maracas",
    "Mid Tom",
    "Open Hat",
    "Mid Conga",
    "High Tom",
    "Cymbal",
    "High Conga",
    "Cowbell",
  ]),
  bank("tr-909", "TR-909", [
    "Kick",
    "Rimshot",
    "Snare",
    "Clap",
    "Snare Tight",
    "Low Tom",
    "Closed Hat",
    "Floor Tom",
    "Pedal Hat",
    "Mid Tom",
    "Open Hat",
    "Mid Tom 2",
    "High Tom",
    "Crash",
    "High Tom 2",
    "Ride",
  ]),
  bank("cr-78", "CR-78", [
    "Kick",
    "Rimshot",
    "Snare",
    "Guiro",
    "Snare Soft",
    "Low Bongo",
    "Closed Hat",
    "Low Conga",
    "Maracas",
    "High Bongo",
    "Open Hat",
    "Tambourine",
    "Claves",
    "Cymbal",
    "Cowbell",
    "Metal Beat",
  ]),
  bank("chip", "8-Bit", [
    "Kick",
    "Blip",
    "Snare",
    "Clap",
    "Snare Short",
    "Low Tom",
    "Closed Hat",
    "Floor Tom",
    "Pedal Hat",
    "Mid Tom",
    "Open Hat",
    "Zap",
    "High Tom",
    "Crash",
    "Laser",
    "Ride",
  ]),
];

/** The bank a new Drum Rack plays. */
export const DEFAULT_DRUM_BANK = DRUM_BANKS[0];

export function findDrumBank(id: string | undefined) {
  const wanted = id?.trim().toLowerCase();
  return wanted ? DRUM_BANKS.find((entry) => entry.id === wanted) : undefined;
}

/** The URL the app serves a bank pad's `.wav` file from. */
export function drumBankPadUrl(entry: DrumBank, pad: number) {
  return `/drum-banks/${entry.slug}/${entry.pads[pad].file}`;
}

/** The pad `pitch` plays, or undefined for a note outside the pads. */
export function padForNote(pitch: number) {
  const pad = pitch - FIRST_PAD_NOTE;
  return pad >= 0 && pad < DRUM_PAD_COUNT ? pad : undefined;
}
