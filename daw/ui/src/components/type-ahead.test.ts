import assert from "node:assert/strict";
import test from "node:test";
import type { Camera } from "../ipc/types.ts";
import { typeAheadMatch } from "./type-ahead.ts";

const cameras: Camera[] = [
  "FaceTime HD Camera",
  "iPhone Camera",
  "Logitech BRIO",
  "Logitech C920",
].map((name, index) => ({ id: String(index), name, transport: "usb" }));

test("jumps to the next camera starting with the typed text", () => {
  assert.equal(typeAheadMatch(cameras, "l", 0), 2);
  // Typing the same letter again moves on, wrapping around.
  assert.equal(typeAheadMatch(cameras, "l", 3), 3);
  assert.equal(typeAheadMatch(cameras, "l", 4), 2);
  assert.equal(typeAheadMatch(cameras, "I", 0), 1);
  assert.equal(typeAheadMatch(cameras, "logitech c", 2), 3);
  assert.equal(typeAheadMatch(cameras, "z", 0), -1);
});
