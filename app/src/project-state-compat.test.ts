import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ArrangementClip,
  computeActiveClips,
} from "./composition-active-clips.ts";
import { resolveFillPaint } from "./fill-paint.ts";
import {
  createDefaultAnimation,
  type EffectAnimation,
} from "./fx-animation-defaults.ts";
import {
  addEffect,
  GLOBAL_EFFECT_TRACK_ID,
  mapEffects,
  type SessionEffect,
} from "./fx-stack.ts";
import {
  migrateClipContentEffects,
  migrateColorizeReactivity,
  migrateDefaultOrder,
  migrateLegacyMainAudio,
  stripClipSelectionFlags,
} from "./project-state-compat.ts";
import { resolveTextStyle } from "./text-style.ts";

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

describe("migrateColorizeReactivity", () => {
  function colorize(
    reactivity: number | undefined,
    animation?: EffectAnimation,
  ) {
    return mapEffects([
      {
        id: "colorize",
        trackId: "6",
        effectName: "Colorize",
        parameters: {
          _HueOffset: { floatValue: 0.25 },
          ...(reactivity === undefined
            ? {}
            : { _Reactivity: { floatValue: reactivity } }),
        },
        ...(animation ? { animation } : {}),
      },
    ]);
  }

  it("turns an old Reactivity into Reactive animation on Hue Shift", () => {
    const [effect] = migrateColorizeReactivity(colorize(0.4));
    const defaults = createDefaultAnimation("Colorize");
    assert.ok(defaults);
    assert.deepEqual(
      effect.parameters.map((parameter) => parameter.key),
      ["_HueOffset"],
    );
    assert.deepEqual(effect.animation, {
      ...defaults,
      enabled: true,
      mode: "reactive",
      reactive: {
        ...defaults.reactive,
        reactivity: 0.4,
        parameters: ["_HueOffset"],
      },
    });
  });

  it("drops a zero Reactivity without turning animation on", () => {
    const [effect] = migrateColorizeReactivity(colorize(0));
    assert.deepEqual(
      effect.parameters.map((parameter) => parameter.key),
      ["_HueOffset"],
    );
    assert.equal(effect.animation, undefined);
  });

  it("keeps animation settings a Colorize already has", () => {
    const animation = createDefaultAnimation("Colorize");
    assert.ok(animation);
    const [before] = colorize(0.4, { ...animation, enabled: false });
    const [effect] = migrateColorizeReactivity([before]);
    assert.deepEqual(
      effect.parameters.map((parameter) => parameter.key),
      ["_HueOffset"],
    );
    assert.equal(effect.animation, before.animation);
    assert.equal(effect.animation?.enabled, false);
  });

  it("returns sessions without an old Reactivity as they are", () => {
    const effects = colorize(undefined);
    assert.equal(migrateColorizeReactivity(effects), effects);
    const migrated = migrateColorizeReactivity(colorize(0.4));
    assert.equal(migrateColorizeReactivity(migrated), migrated);
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

  it("adds the older session's Order without animation", () => {
    const [order] = globalOrders(migrateDefaultOrder([], undefined));
    assert.equal("animation" in order, false);
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

describe("migrateClipContentEffects", () => {
  const text = (id: string, trackId: string, value: string): SessionEffect => ({
    id,
    trackId,
    effectName: "Text",
    parameters: [{ key: "Text", value }],
    enabled: true,
  });
  const color = (
    id: string,
    trackId: string,
    value: string,
  ): SessionEffect => ({
    id,
    trackId,
    effectName: "Color",
    parameters: [
      { key: "Mode", value: "Solid" },
      { key: "Color", value },
    ],
    enabled: true,
  });
  const colorize: SessionEffect = {
    id: "colorize",
    trackId: "1",
    effectName: "Colorize",
    parameters: [],
    enabled: true,
  };
  const counter = () => {
    let next = 0;
    return () => `new-${++next}`;
  };
  const migrate = (
    effects: SessionEffect[],
    clips: { id: string; laneId: string; kind?: string }[],
  ) => migrateClipContentEffects(effects, clips, undefined, counter());

  it("moves a layer's Text onto its text clip", () => {
    const effects = [colorize, text("t", "1", "Hello")];
    const clips = [{ id: "a", laneId: "1", kind: "text" }];
    const migrated = migrate(effects, clips);

    assert.deepEqual(migrated, [
      colorize,
      { ...text("t", "1", "Hello"), id: "new-1", trackId: "clip:a" },
    ]);
    assert.deepEqual(
      resolveTextStyle(migrated, "1", "clip:a"),
      resolveTextStyle(effects, "1", "clip:a"),
    );
  });

  it("gives every text clip on a layer its own copy", () => {
    const effects = [text("t", "1", "Hello")];
    const clips = [
      { id: "a", laneId: "1", kind: "text" },
      { id: "b", laneId: "1", kind: "text" },
      { id: "c", laneId: "2", kind: "text" },
    ];
    const migrated = migrate(effects, clips);

    assert.deepEqual(
      migrated.map((effect) => [effect.id, effect.trackId]),
      [
        ["new-1", "clip:a"],
        ["new-2", "clip:b"],
      ],
    );
    assert.equal(resolveTextStyle(migrated, "1", "clip:a").text, "Hello");
    assert.equal(resolveTextStyle(migrated, "1", "clip:b").text, "Hello");
    // Copies are independent: editing one leaves the other.
    migrated[0].parameters[0].value = "Changed";
    assert.equal(resolveTextStyle(migrated, "1", "clip:b").text, "Hello");
    assert.equal(effects[0].parameters[0].value, "Hello");
  });

  it("drops Text from a layer with no text clips", () => {
    assert.deepEqual(migrate([colorize, text("t", "1", "Hi")], []), [colorize]);
  });

  it("keeps a clip's own Text", () => {
    const own = text("own", "clip:a", "Mine");
    const migrated = migrate(
      [text("t", "1", "Layer"), own],
      [{ id: "a", laneId: "1", kind: "text" }],
    );
    assert.deepEqual(migrated, [own]);
  });

  it("moves Color off a layer holding only fill clips", () => {
    const effects = [color("c", "1", "rgba(255,0,0,1)"), colorize];
    const clips = [
      { id: "a", laneId: "1", kind: "fill" },
      { id: "b", laneId: "1", kind: "fill" },
    ];
    const migrated = migrate(effects, clips);

    assert.deepEqual(
      migrated.map((effect) => [effect.id, effect.trackId]),
      [
        ["colorize", "1"],
        ["new-1", "clip:a"],
        ["new-2", "clip:b"],
      ],
    );
    for (const clipId of ["a", "b"]) {
      assert.deepEqual(
        resolveFillPaint(migrated, "1", `clip:${clipId}`),
        resolveFillPaint(effects, "1", `clip:${clipId}`),
      );
    }
  });

  it("leaves Color on a layer mixing fill and media clips", () => {
    const layerColor = color("c", "1", "rgba(255,0,0,1)");
    const migrated = migrate(
      [layerColor],
      [
        { id: "a", laneId: "1", kind: "fill" },
        { id: "m", laneId: "1" },
      ],
    );

    assert.deepEqual(
      migrated.map((effect) => [effect.id, effect.trackId]),
      [
        ["c", "1"],
        ["new-1", "clip:a"],
      ],
    );
  });

  it("leaves Color on a layer without fill clips", () => {
    const effects = [color("c", "1", "rgba(255,0,0,1)")];
    assert.equal(migrate(effects, [{ id: "m", laneId: "1" }]), effects);
    assert.equal(migrate(effects, []), effects);
  });

  it("puts the copy ahead of the clip's other effects", () => {
    const clipColorize = { ...colorize, id: "cc", trackId: "clip:a" };
    const migrated = migrate(
      [clipColorize, text("t", "1", "Hi")],
      [{ id: "a", laneId: "1", kind: "text" }],
    );
    assert.deepEqual(
      migrated.map((effect) => effect.id),
      ["new-1", "cc"],
    );
  });

  it("renders a migrated session as before", () => {
    const effects = [
      text("t", "1", "Title"),
      color("c", "2", "rgba(0,255,0,1)"),
    ];
    const clip: ArrangementClip = {
      id: "a",
      kind: "text",
      laneId: "1",
      sourceTrackId: "",
      label: "Text",
      mediaPath: "",
      startQ: 0,
      durationSeconds: 4,
      trimStartSeconds: 0,
      sourceOffsetSeconds: 0,
      sourceWindowStartSeconds: 0,
      sourceWindowEndSeconds: 4,
      tint: "",
      accent: "",
    };
    const clips: ArrangementClip[] = [
      clip,
      { ...clip, id: "b", laneId: "2", kind: "fill" },
    ];
    const render = (stack: SessionEffect[]) =>
      computeActiveClips(
        clips,
        new Map(),
        1,
        120,
        new Map([
          ["1", 0],
          ["2", 1],
        ]),
        stack,
      ).map(({ text, fill }) => ({ text, fill }));

    assert.deepEqual(render(migrate(effects, clips)), render(effects));
  });

  it("keeps the stacks of a session saved since", () => {
    const effects = [text("t", "1", "Hi")];
    assert.equal(
      migrateClipContentEffects(
        effects,
        [{ id: "a", laneId: "1", kind: "text" }],
        true,
      ),
      effects,
    );
  });
});
