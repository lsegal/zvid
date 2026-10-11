import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPhoneShell, pickShellKind } from "./shell-kind.ts";

describe("pickShellKind", () => {
  it("gives a portrait phone the mobile shell", () => {
    assert.equal(
      pickShellKind({ width: 390, height: 844, coarsePointer: true }),
      "phone",
    );
  });

  it("gives a phone held sideways the landscape mobile shell", () => {
    assert.equal(
      pickShellKind({ width: 844, height: 390, coarsePointer: true }),
      "phone-landscape",
    );
  });

  it("keeps the desktop layout in a narrow window with a mouse", () => {
    assert.equal(
      pickShellKind({ width: 390, height: 844, coarsePointer: false }),
      "desktop",
    );
    assert.equal(
      pickShellKind({ width: 700, height: 500, coarsePointer: false }),
      "desktop",
    );
  });

  it("keeps the desktop layout on tablets either way up", () => {
    assert.equal(
      pickShellKind({ width: 768, height: 1024, coarsePointer: true }),
      "desktop",
    );
    assert.equal(
      pickShellKind({ width: 1180, height: 820, coarsePointer: true }),
      "desktop",
    );
  });

  it("stays on the desktop layout before the viewport is known", () => {
    assert.equal(
      pickShellKind({ width: 0, height: 0, coarsePointer: true }),
      "desktop",
    );
  });

  it("tells phone shells from the desktop one", () => {
    assert.equal(isPhoneShell("phone"), true);
    assert.equal(isPhoneShell("phone-landscape"), true);
    assert.equal(isPhoneShell("desktop"), false);
  });
});
