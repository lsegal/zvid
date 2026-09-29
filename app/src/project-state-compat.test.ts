import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addEffect, GLOBAL_EFFECT_TRACK_ID } from "./fx-stack.ts";
import {
  migrateDefaultOrder,
  migrateLegacyMainAudio,
  stripClipSelectionFlags,
} from "./project-state-compat.ts";

describe("migrateLegacyMainAudio", () => {
  it("reads a legacy masterAudioId as mainAudioId", () => {
    assert.deepEqual(migrateLegacyMainAudio({ bpm: 120, masterAudioId: "a" }), {
      bpm: 120,
      mainAudioId: "a",
    });
  });

  it("prefers mainAudioId when both are present", () => {
    assert.deepEqual(
      migrateLegacyMainAudio({ mainAudioId: "new", masterAudioId: "old" }),
      { mainAudioId: "new" },
    );
  });

  it("returns current snapshots unchanged", () => {
    const snapshot = { bpm: 120, mainAudioId: "a" };
    assert.equal(migrateLegacyMainAudio(snapshot), snapshot);
  });
});

describe("stripClipSelectionFlags", () => {
  it("drops leftover selected flags from clips", () => {
    assert.deepEqual(
      stripClipSelectionFlags({
        bpm: 120,
        clips: [
          { id: "a", selected: true },
          { id: "b", selected: false },
          { id: "c" },
        ],
      }),
      { bpm: 120, clips: [{ id: "a" }, { id: "b" }, { id: "c" }] },
    );
  });

  it("returns snapshots without flags unchanged", () => {
    const snapshot = { bpm: 120, clips: [{ id: "a" }] };
    assert.equal(stripClipSelectionFlags(snapshot), snapshot);
  });
});

describe("migrateDefaultOrder", () => {
  const globalOrders = (effects: ReturnType<typeof migrateDefaultOrder>) =>
    effects.filter(
      (effect) =>
        effect.trackId === GLOBAL_EFFECT_TRACK_ID &&
        effect.effectName === "Order",
    );

  it("adds one Vertical Order with no spacing to an older session", () => {
    const orders = globalOrders(migrateDefaultOrder([], undefined));
    assert.equal(orders.length, 1);
    const [order] = orders;
    assert.equal(order.enabled, true);
    const value = (key: string) =>
      order.parameters.find((parameter) => parameter.key === key);
    assert.equal(value("Arrangement")?.value, "Vertical");
    assert.equal(value("Spacing")?.numericValue, 0);
  });

  it("keeps the Global stack of a session saved without Order since", () => {
    const effects = addEffect([], GLOBAL_EFFECT_TRACK_ID, "Colorize", 0, "c");
    assert.equal(migrateDefaultOrder(effects, true), effects);
  });

  it("leaves an older session's own Order alone, even bypassed", () => {
    const effects = addEffect([], GLOBAL_EFFECT_TRACK_ID, "Order", 0, "o").map(
      (effect) => ({ ...effect, enabled: false }),
    );
    assert.equal(migrateDefaultOrder(effects, undefined), effects);
  });
});
