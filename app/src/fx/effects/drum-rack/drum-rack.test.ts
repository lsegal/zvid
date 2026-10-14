import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { MediaItem } from "../../../media.ts";
import {
  DEFAULT_DRUM_BANK,
  DRUM_BANKS,
  DRUM_PAD_COUNT,
  drumBankPadUrl,
  findDrumBank,
  padForNote,
} from "./banks.ts";
import {
  drumRackParams,
  importDrumSample,
  setDrumSampleImporter,
  setDrumSampleMedia,
} from "./drum-media.ts";
import {
  DEFAULT_DRUM_RACK,
  DEFAULT_DRUM_RACK_VALUE,
  DRUM_RACK_KEY,
  drumPadFileName,
  formatDrumRack,
  parseDrumRack,
  readDrumRackEffect,
  withDrumBank,
  withDrumPad,
} from "./drum-rack.ts";

const tr909 = findDrumBank("builtin:tr-909");

function audio(name: string, overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: name,
    name,
    kind: "audio",
    durationSeconds: 1,
    hasAudio: true,
    hasVideo: false,
    color: "#000",
    accent: "#fff",
    previewUrl: `blob:${name}`,
    availability: "ready",
    ...overrides,
  };
}

afterEach(() => {
  setDrumSampleMedia([]);
  setDrumSampleImporter(undefined);
});

describe("drum banks", () => {
  it("fill 16 named pads each, with unique stable ids and files", () => {
    assert.ok(DRUM_BANKS.length >= 4);
    assert.equal(
      new Set(DRUM_BANKS.map((bank) => bank.id)).size,
      DRUM_BANKS.length,
    );
    assert.equal(
      new Set(DRUM_BANKS.map((bank) => bank.slug)).size,
      DRUM_BANKS.length,
    );
    for (const bank of DRUM_BANKS) {
      assert.match(bank.id, /^builtin:[a-z0-9-]+$/);
      assert.equal(bank.pads.length, DRUM_PAD_COUNT);
      assert.equal(
        new Set(bank.pads.map((pad) => pad.file)).size,
        DRUM_PAD_COUNT,
      );
      assert.equal(findDrumBank(` ${bank.id.toUpperCase()} `), bank);
    }
    assert.deepEqual(
      DRUM_BANKS.slice(0, 2).map((bank) => bank.name),
      ["TR-808", "TR-909"],
    );
    assert.equal(findDrumBank("builtin:missing"), undefined);
    assert.equal(findDrumBank(undefined), undefined);
  });

  it("serve each bank's pads from its own folder", () => {
    assert.equal(
      drumBankPadUrl(DEFAULT_DRUM_BANK, 0),
      "/drum-banks/tr-808/01-kick.wav",
    );
    assert.ok(tr909);
    assert.equal(drumBankPadUrl(tr909, 15), "/drum-banks/tr-909/16-ride.wav");
  });

  it("map General MIDI's drum notes 36 to 51 onto the pads", () => {
    assert.equal(padForNote(36), 0);
    assert.equal(padForNote(51), 15);
    assert.equal(padForNote(35), undefined);
    assert.equal(padForNote(52), undefined);
  });
});

describe("Drum Rack settings", () => {
  it("default to the first bank with no pads of their own", () => {
    assert.deepEqual(parseDrumRack(DEFAULT_DRUM_RACK_VALUE), DEFAULT_DRUM_RACK);
    assert.equal(DEFAULT_DRUM_RACK.bank, "builtin:tr-808");
    assert.equal(DEFAULT_DRUM_RACK.pads.length, DRUM_PAD_COUNT);
  });

  it("round-trip a bank and pads' own samples by pad number", () => {
    const settings = withDrumPad(
      withDrumPad(parseDrumRack(DEFAULT_DRUM_RACK_VALUE), 0, "kick.wav"),
      15,
      "loops/ride.wav",
    );
    const value = formatDrumRack({ ...settings, bank: "builtin:cr-78" });
    assert.equal(
      value,
      '{"bank":"builtin:cr-78","pads":{"1":"kick.wav","16":"loops/ride.wav"}}',
    );
    const parsed = parseDrumRack(value);
    assert.equal(parsed.bank, "builtin:cr-78");
    assert.equal(parsed.pads[0], "kick.wav");
    assert.equal(parsed.pads[15], "loops/ride.wav");
    assert.equal(parsed.pads[1], undefined);
  });

  it("fall back to the defaults for values they can't read", () => {
    for (const value of [undefined, "", "nope", "[]", "null", "3"]) {
      assert.deepEqual(parseDrumRack(value), DEFAULT_DRUM_RACK);
    }
    const parsed = parseDrumRack(
      '{"bank":"builtin:missing","pads":{"0":"a.wav","2":" ","3":7,"17":"b.wav","4":"c.wav"}}',
    );
    assert.equal(parsed.bank, DEFAULT_DRUM_BANK.id);
    assert.deepEqual(
      parsed.pads.flatMap((path, pad) => (path ? [[pad, path]] : [])),
      [[3, "c.wav"]],
    );
  });

  it("set every pad back to the new bank's samples when the bank changes", () => {
    assert.ok(tr909);
    const custom = withDrumPad(DEFAULT_DRUM_RACK, 4, "snare.wav");
    const switched = withDrumBank(custom, tr909);
    assert.equal(switched.bank, tr909.id);
    assert.ok(switched.pads.every((path) => path === undefined));
  });

  it("read from the effect's Pads parameter", () => {
    const value = formatDrumRack(withDrumPad(DEFAULT_DRUM_RACK, 2, "clap.wav"));
    assert.equal(
      readDrumRackEffect([{ key: DRUM_RACK_KEY, value }]).pads[2],
      "clap.wav",
    );
    assert.deepEqual(readDrumRackEffect([]), DEFAULT_DRUM_RACK);
  });

  it("name a pad's own sample by its file name", () => {
    assert.equal(drumPadFileName("C:\\samples\\kick.wav"), "kick.wav");
    assert.equal(drumPadFileName("samples/snare.wav"), "snare.wav");
    assert.equal(drumPadFileName("hat.wav"), "hat.wav");
  });
});

describe("drumRackParams", () => {
  it("plays the bank's sample on every pad without one of its own", () => {
    assert.ok(tr909);
    const { samples } = drumRackParams(withDrumBank(DEFAULT_DRUM_RACK, tr909));
    assert.deepEqual(
      samples,
      tr909.pads.map((_, pad) => drumBankPadUrl(tr909, pad)),
    );
  });

  it("plays a pad's own media while it is online, and nothing while it isn't", () => {
    setDrumSampleMedia([
      audio("kick.wav", { sourcePath: "C:\\drums\\kick.wav" }),
      audio("snare.wav", { availability: "offline" }),
      audio("hat.png", { kind: "image" }),
    ]);
    const settings = [
      [0, "C:\\drums\\kick.wav"],
      [1, "snare.wav"],
      [2, "hat.png"],
      [3, "missing.wav"],
    ].reduce(
      (current, [pad, path]) =>
        withDrumPad(current, pad as number, path as string),
      DEFAULT_DRUM_RACK,
    );
    const { samples } = drumRackParams(settings);
    assert.deepEqual(samples.slice(0, 5), [
      "blob:kick.wav",
      null,
      null,
      null,
      drumBankPadUrl(DEFAULT_DRUM_BANK, 4),
    ]);
  });
});

describe("importDrumSample", () => {
  it("imports through the app's importer, and does nothing without one", async () => {
    assert.equal(await importDrumSample(), undefined);
    const calls: (readonly File[] | undefined)[] = [];
    setDrumSampleImporter(async (files) => {
      calls.push(files);
      return "kick.wav";
    });
    assert.equal(await importDrumSample(), "kick.wav");
    assert.deepEqual(calls, [undefined]);
  });
});
