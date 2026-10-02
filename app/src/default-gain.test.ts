import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDefaultGain, migrateDefaultGain } from "./default-gain.ts";
import type { SessionEffect } from "./fx-stack.ts";
import type { MediaItem } from "./media.ts";

function media(
  id: string,
  hasAudio: boolean,
  durationSeconds = 4,
): Pick<MediaItem, "id" | "hasAudio" | "durationSeconds"> {
  return { id, hasAudio, durationSeconds };
}

const MEDIA = [
  media("song", true),
  media("take", true),
  media("silent", false),
  // Not read yet, like a just-opened session's placeholder.
  media("pending", false, 0),
];

function ids() {
  let next = 0;
  return () => `gain-${++next}`;
}

function gainStacks(effects: readonly SessionEffect[]) {
  return effects
    .filter((effect) => effect.effectName === "Gain")
    .map((effect) => effect.trackId);
}

describe("addDefaultGain", () => {
  it("gives each clip with sound a 0 dB Gain in its own stack", () => {
    const effects = addDefaultGain(
      [],
      {
        clips: [{ id: "c1", mediaId: "take" }],
        sourceSpans: [{ id: "s1", mediaId: "song" }],
      },
      MEDIA,
      ids(),
    );
    assert.deepEqual(effects, [
      {
        id: "gain-1",
        trackId: "clip:c1",
        effectName: "Gain",
        enabled: true,
        parameters: [
          { key: "Gain", value: "0.000", numericValue: 0 },
          { key: "Mute", value: "0.000", numericValue: 0 },
        ],
      },
      {
        id: "gain-2",
        trackId: "source-clip:s1",
        effectName: "Gain",
        enabled: true,
        parameters: [
          { key: "Gain", value: "0.000", numericValue: 0 },
          { key: "Mute", value: "0.000", numericValue: 0 },
        ],
      },
    ]);
  });

  it("gives none to video-only media, fill, text and FX clips", () => {
    const effects: SessionEffect[] = [];
    assert.equal(
      addDefaultGain(
        effects,
        {
          clips: [
            { id: "video", mediaId: "silent" },
            { id: "fill", kind: "fill" },
            { id: "text", kind: "text" },
            { id: "fx", kind: "fx" },
          ],
          sourceSpans: [{ id: "s1", mediaId: "silent" }],
        },
        MEDIA,
      ),
      effects,
    );
  });

  it("gives one to media that hasn't been read yet or is missing", () => {
    const effects = addDefaultGain(
      [],
      {
        clips: [{ id: "pending", mediaId: "pending" }, { id: "missing" }],
        sourceSpans: [{ id: "s1", mediaId: "gone" }],
      },
      MEDIA,
      ids(),
    );
    assert.deepEqual(gainStacks(effects), [
      "clip:pending",
      "clip:missing",
      "source-clip:s1",
    ]);
  });

  it("adds it after the stack's other effects, once", () => {
    const pixelate: SessionEffect = {
      id: "p",
      trackId: "clip:c1",
      effectName: "Pixelate",
      parameters: [],
      enabled: true,
    };
    const effects = addDefaultGain(
      [pixelate],
      {
        clips: [
          { id: "c1", mediaId: "take" },
          { id: "c1", mediaId: "take" },
        ],
      },
      MEDIA,
      ids(),
    );
    assert.deepEqual(
      effects.map((effect) => effect.id),
      ["p", "gain-1"],
    );
  });

  it("leaves a stack that already has a Gain, even a bypassed one", () => {
    const bypassed: SessionEffect = {
      id: "g",
      trackId: "clip:c1",
      effectName: "Gain",
      parameters: [{ key: "Gain", value: "-6", numericValue: -6 }],
      enabled: false,
    };
    const effects = [bypassed];
    assert.equal(
      addDefaultGain(
        effects,
        { clips: [{ id: "c1", mediaId: "take" }] },
        MEDIA,
      ),
      effects,
    );
  });
});

describe("migrateDefaultGain", () => {
  const targets = {
    clips: [
      { id: "c1", mediaId: "take" },
      { id: "c2", mediaId: "take" },
      { id: "v", mediaId: "silent" },
      { id: "t", kind: "text" },
    ],
    sourceSpans: [
      { id: "s1", mediaId: "song" },
      { id: "s2", mediaId: "silent" },
    ],
  };

  it("adds exactly one Gain to each clip with sound in an older session", () => {
    const existing: SessionEffect = {
      id: "kept",
      trackId: "clip:c2",
      effectName: "Gain",
      parameters: [{ key: "Gain", value: "-3", numericValue: -3 }],
      enabled: true,
    };
    const effects = migrateDefaultGain(
      [existing],
      targets,
      MEDIA,
      undefined,
      ids(),
    );
    assert.deepEqual(gainStacks(effects).toSorted(), [
      "clip:c1",
      "clip:c2",
      "source-clip:s1",
    ]);
    assert.equal(effects[0], existing);
  });

  it("leaves a session saved since as it is", () => {
    const effects: SessionEffect[] = [];
    assert.equal(migrateDefaultGain(effects, targets, MEDIA, true), effects);
  });
});
