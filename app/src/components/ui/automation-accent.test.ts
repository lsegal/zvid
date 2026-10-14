import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { automationAccent } from "./automation-accent.ts";

// How far apart two hex colors are, 0..~1.7.
function distance(left: string, right: string) {
  const channels = (color: string) =>
    [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16) / 255);
  const [a, b] = [channels(left), channels(right)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe("automationAccent", () => {
  it("turns a colorful accent to its opposite hue", () => {
    for (const accent of ["#7ca1ff", "#facc15", "#e879f9", "#4ade80", "#ff6f9d"]) {
      const automation = automationAccent(accent);
      assert.match(automation, /^#[0-9a-f]{6}$/);
      assert.ok(distance(accent, automation) > 0.5, `${accent} → ${automation}`);
    }
  });

  it("gives gray, white and black accents mint", () => {
    for (const accent of ["#fff", "#000", "#cbd5e1", "#e8e4ff"]) {
      assert.equal(automationAccent(accent), "#7ee0a4");
    }
  });

  it("gives a color it can't read mint", () => {
    assert.equal(automationAccent("var(--pink)"), "#7ee0a4");
  });
});
