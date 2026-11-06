import assert from "node:assert/strict";
import test from "node:test";
import {
  PIANO_ROLL_HIGH_PITCH,
  PIANO_ROLL_LOW_PITCH,
} from "../midi-piano-roll.ts";
import {
  COMPUTER_KEYBOARD_STORAGE_KEY,
  computerKeyboardKey,
  createComputerKeyboardEntry,
  shiftBasePitch,
} from "./computer-keyboard.ts";

function memoryStorage(initial?: string) {
  const items = new Map<string, string>();
  if (initial !== undefined) {
    items.set(COMPUTER_KEYBOARD_STORAGE_KEY, initial);
  }
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

test("the home row plays white keys and the row above black keys", () => {
  const offsets = (codes: string[]) =>
    codes.map((code) => {
      const key = computerKeyboardKey(code);
      return key?.kind === "note" ? key.offset : undefined;
    });
  assert.deepEqual(
    offsets(["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK"]),
    [0, 2, 4, 5, 7, 9, 11, 12],
  );
  assert.deepEqual(
    offsets(["KeyW", "KeyE", "KeyT", "KeyY", "KeyU"]),
    [1, 3, 6, 8, 10],
  );
});

test("Z and X shift the octave and other keys do nothing", () => {
  assert.deepEqual(computerKeyboardKey("KeyZ"), {
    kind: "octave",
    direction: -1,
  });
  assert.deepEqual(computerKeyboardKey("KeyX"), {
    kind: "octave",
    direction: 1,
  });
  for (const code of ["KeyQ", "KeyR", "Space", "ArrowUp", "constructor"]) {
    assert.equal(computerKeyboardKey(code), undefined);
  }
});

test("octave shifts keep every key within the piano roll", () => {
  const limit = (direction: -1 | 1) => {
    let pitch = 60;
    for (let step = 0; step < 20; step += 1) {
      pitch = shiftBasePitch(pitch, direction);
    }
    return pitch;
  };
  assert.equal(shiftBasePitch(60, 1), 72);
  assert.equal(shiftBasePitch(60, -1), 48);
  assert.equal(limit(-1), PIANO_ROLL_LOW_PITCH);
  assert.equal(limit(1) + 12, PIANO_ROLL_HIGH_PITCH);
});

test("entry starts off and remembers the toggle, not the octave", () => {
  const storage = memoryStorage();
  const entry = createComputerKeyboardEntry({ storage });
  assert.deepEqual(entry.getState(), { enabled: false, basePitch: 60 });
  entry.setEnabled(true);
  entry.shiftOctave(1);
  assert.deepEqual(entry.getState(), { enabled: true, basePitch: 72 });
  assert.deepEqual(createComputerKeyboardEntry({ storage }).getState(), {
    enabled: true,
    basePitch: 60,
  });
});

test("corrupt saved data leaves entry off", () => {
  const entry = createComputerKeyboardEntry({ storage: memoryStorage("{") });
  assert.equal(entry.getState().enabled, false);
});

test("listeners hear changes only when the state changes", () => {
  const entry = createComputerKeyboardEntry({ storage: memoryStorage() });
  let calls = 0;
  const stop = entry.subscribe(() => {
    calls += 1;
  });
  entry.setEnabled(false);
  assert.equal(calls, 0);
  entry.setEnabled(true);
  assert.equal(calls, 1);
  stop();
  entry.setEnabled(false);
  assert.equal(calls, 1);
});

test("entry claims plain note keys only while it's playing a roll", () => {
  const entry = createComputerKeyboardEntry({ storage: memoryStorage() });
  const press = {
    code: "KeyA",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };
  assert.equal(entry.claimsKey(press), false);
  const stop = entry.claimKeys();
  assert.equal(entry.claimsKey(press), true);
  assert.equal(entry.claimsKey({ ...press, code: "KeyZ" }), true);
  assert.equal(entry.claimsKey({ ...press, code: "KeyQ" }), false);
  assert.equal(entry.claimsKey({ ...press, shiftKey: true }), false);
  assert.equal(entry.claimsKey({ ...press, ctrlKey: true }), false);
  stop();
  assert.equal(entry.claimsKey(press), false);
});
