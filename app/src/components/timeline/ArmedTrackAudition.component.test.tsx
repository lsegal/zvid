import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { sourceTrackEffectTrackId } from "../../fx-stack.ts";
import { DEFAULT_SYNTH_PARAMS, type SynthParams } from "../../midi-clip.ts";
import { createSynthEffect } from "../../midi-effects.ts";
import { computerKeyboardEntry } from "../../midi-input/computer-keyboard.ts";
import {
  type MidiAccessLike,
  type MidiInputPort,
  midiInputHub,
} from "../../midi-input/input-hub.ts";
import { createPlayheadSignal } from "../../playhead-signal.ts";
import {
  type ArmedAuditionSession,
  claimRollKeys,
  setArmedAuditionSource,
} from "../../recording/armed-audition.ts";
import { MidiTake } from "../../recording/midi-take.ts";
import { disarmAllTracks, setTrackArmed } from "../../recording/record-arm.ts";
import { ArmedTrackAudition } from "./ArmedTrackAudition";
import { MidiTakeCapture } from "./MidiTakeCapture";

// Keys sound through every armed track's own instrument, with no clip selected
// and no piano roll open (#1599).
const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;

const wave = (trackId: string, type: SynthParams["wave"]) =>
  createSynthEffect(sourceTrackEffectTrackId(trackId), {
    ...DEFAULT_SYNTH_PARAMS,
    wave: type,
  });
const session = {
  sourceTracks: [{ id: "square" }, { id: "saw" }, { id: "empty" }],
  sourceSpans: [
    { id: "m1", sourceTrackId: "square", startQ: 0, notes: [] },
    { id: "m2", sourceTrackId: "saw", startQ: 0, notes: [] },
  ],
  effects: [wave("square", "square"), wave("saw", "sawtooth")],
} as unknown as ArmedAuditionSession;

const port: MidiInputPort = {
  id: "keys",
  name: "Test Keys",
  state: "connected",
  onmidimessage: null,
};
const access: MidiAccessLike = {
  inputs: { values: () => [port] },
  onstatechange: null,
};

function send(status: number, pitch: number) {
  port.onmidimessage?.({ data: new Uint8Array([status, pitch, 100]) });
}

let stopListening = () => {};
let oscillators: OscillatorNode[] = [];
const sounding = () => oscillators.map((oscillator) => oscillator.type).sort();

beforeEach(async () => {
  oscillators = [];
  const create = AudioContext.prototype.createOscillator;
  vi.spyOn(AudioContext.prototype, "createOscillator").mockImplementation(
    function (this: AudioContext) {
      const oscillator = create.call(this);
      vi.spyOn(oscillator, "stop");
      oscillators.push(oscillator);
      return oscillator;
    },
  );
  (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess = async () =>
    access;
  midiInputHub.setEnabled(true);
  computerKeyboardEntry.setEnabled(true);
  // Keeps the port open, so a key not sounding is one that was heard.
  stopListening = midiInputHub.listen({ message() {}, disconnected() {} });
  await expect.poll(() => port.onmidimessage).not.toBeNull();
});

afterEach(() => {
  stopListening();
  vi.restoreAllMocks();
  disarmAllTracks();
  midiInputHub.setEnabled(false);
  computerKeyboardEntry.setEnabled(false);
  port.onmidimessage = null;
});

const playheadSignal = createPlayheadSignal(0);
const audition = (selectedTrackId?: string) => (
  <ArmedTrackAudition
    playheadSignal={playheadSignal}
    selectedTrackId={selectedTrackId}
    session={session}
  />
);

async function renderAudition(selectedTrackId?: string) {
  return render(audition(selectedTrackId));
}

function fire(type: "keydown" | "keyup", code: string) {
  const event = new KeyboardEvent(type, {
    code,
    bubbles: true,
    cancelable: true,
  });
  document.body.dispatchEvent(event);
  return event.defaultPrevented;
}

test("nothing armed: keys sound nothing and typed keys stay free", async () => {
  await renderAudition();
  send(NOTE_ON, 60);
  expect(fire("keydown", "KeyA")).toBe(false);
  fire("keyup", "KeyA");
  send(NOTE_OFF, 60);
  expect(sounding()).toEqual([]);
});

test("a device key holds an armed track's instrument until it comes up", async () => {
  setTrackArmed("square", true);
  await renderAudition();
  send(NOTE_ON, 60);
  expect(sounding()).toEqual(["square"]);
  expect(oscillators[0].stop).not.toHaveBeenCalled();
  send(NOTE_OFF, 60);
  expect(oscillators[0].stop).toHaveBeenCalledOnce();
});

test("a second armed track sounds on the same note, from either input", async () => {
  setTrackArmed("square", true);
  setTrackArmed("saw", true);
  await renderAudition();
  send(NOTE_ON, 60);
  expect(sounding()).toEqual(["sawtooth", "square"]);
  send(NOTE_OFF, 60);

  oscillators = [];
  await expect.poll(() => fire("keydown", "KeyA")).toBe(true);
  expect(sounding()).toEqual(["sawtooth", "square"]);
  for (const oscillator of oscillators) {
    expect(oscillator.stop).not.toHaveBeenCalled();
  }
  fire("keyup", "KeyA");
  for (const oscillator of oscillators) {
    expect(oscillator.stop).toHaveBeenCalledOnce();
  }
});

test("an armed track with no instrument stays silent beside one with", async () => {
  setTrackArmed("empty", true);
  await renderAudition();
  send(NOTE_ON, 60);
  send(NOTE_OFF, 60);
  expect(fire("keydown", "KeyA")).toBe(false);
  fire("keyup", "KeyA");
  expect(sounding()).toEqual([]);

  setTrackArmed("saw", true);
  await expect.poll(() => fire("keydown", "KeyS")).toBe(true);
  fire("keyup", "KeyS");
  expect(sounding()).toEqual(["sawtooth"]);
});

test("a piano roll taking the keys takes over from it", async () => {
  setTrackArmed("square", true);
  await renderAudition();
  const unclaim = claimRollKeys();
  await expect.poll(() => fire("keydown", "KeyA")).toBe(false);
  fire("keyup", "KeyA");
  send(NOTE_ON, 60);
  send(NOTE_OFF, 60);
  expect(sounding()).toEqual([]);
  unclaim();
  await expect.poll(() => fire("keydown", "KeyD")).toBe(true);
  fire("keyup", "KeyD");
  expect(sounding()).toEqual(["square"]);
});

// With nothing armed, keys fall back to the selected track (#1618).
test("with none armed, keys hold the selected track's instrument, from either input", async () => {
  await renderAudition("square");
  send(NOTE_ON, 60);
  expect(sounding()).toEqual(["square"]);
  expect(oscillators[0].stop).not.toHaveBeenCalled();
  send(NOTE_OFF, 60);
  expect(oscillators[0].stop).toHaveBeenCalledOnce();

  oscillators = [];
  await expect.poll(() => fire("keydown", "KeyA")).toBe(true);
  expect(sounding()).toEqual(["square"]);
  expect(oscillators[0].stop).not.toHaveBeenCalled();
  fire("keyup", "KeyA");
  expect(oscillators[0].stop).toHaveBeenCalledOnce();
});

test("selecting another track retargets the keys", async () => {
  const { rerender } = await renderAudition("square");
  send(NOTE_ON, 60);
  send(NOTE_OFF, 60);
  expect(sounding()).toEqual(["square"]);

  oscillators = [];
  await rerender(audition("saw"));
  send(NOTE_ON, 60);
  send(NOTE_OFF, 60);
  expect(sounding()).toEqual(["sawtooth"]);
});

test("arming a track takes the keys off the selected track, and disarming hands them back", async () => {
  await renderAudition("square");
  setTrackArmed("saw", true);
  await expect.poll(() => fire("keydown", "KeyA")).toBe(true);
  fire("keyup", "KeyA");
  expect(sounding()).toEqual(["sawtooth"]);

  oscillators = [];
  setTrackArmed("saw", false);
  await expect
    .poll(() => {
      send(NOTE_ON, 60);
      send(NOTE_OFF, 60);
      return sounding().at(-1);
    })
    .toBe("square");
  expect(sounding()).not.toContain("sawtooth");
});

test("an armed track with no instrument stays silent over a selected one with", async () => {
  await renderAudition("square");
  setTrackArmed("empty", true);
  await expect.poll(() => fire("keydown", "KeyA")).toBe(false);
  fire("keyup", "KeyA");
  send(NOTE_ON, 60);
  send(NOTE_OFF, 60);
  expect(sounding()).toEqual([]);
});

test("a selected track with no instrument sounds nothing and leaves typed keys free", async () => {
  await renderAudition("empty");
  send(NOTE_ON, 60);
  send(NOTE_OFF, 60);
  expect(fire("keydown", "KeyA")).toBe(false);
  fire("keyup", "KeyA");
  expect(sounding()).toEqual([]);
});

test("a piano roll taking the keys leaves the selected track silent", async () => {
  await renderAudition("square");
  const unclaim = claimRollKeys();
  await expect.poll(() => fire("keydown", "KeyA")).toBe(false);
  fire("keyup", "KeyA");
  send(NOTE_ON, 60);
  send(NOTE_OFF, 60);
  expect(sounding()).toEqual([]);
  unclaim();
});

test("a MIDI take auditions through the armed tracks, not a default Synth", async () => {
  setTrackArmed("saw", true);
  setTrackArmed("empty", true);
  setArmedAuditionSource(session, () => 0);
  const take = new MidiTake({
    startQ: 0,
    input: "device",
    quantize: "off",
    playheadQ: () => 0,
    bpm: () => 120,
  });
  await render(
    <MidiTakeCapture
      isPlaying
      playheadSignal={createPlayheadSignal(0)}
      take={take}
    />,
  );
  send(NOTE_ON, 60);
  send(NOTE_OFF, 60);
  expect(sounding()).toEqual(["sawtooth"]);
});
