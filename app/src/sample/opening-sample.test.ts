import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PALETTE } from "../app/constants.ts";
import { sessionToProject } from "../app/session-project.ts";
import { resolveAudioClips } from "../audio-mix/resolve.ts";
import { resolveVisualState } from "../composition-active-clips.ts";
import { parseCubeLut } from "../fx/effects/lut/cube.ts";
import { clipEffectTrackId } from "../fx/stack/clip-stacks.ts";
import { normalizeEffectAnimation } from "../fx-animation-defaults.ts";
import { FX_EFFECT_DEFINITIONS } from "../fx-registry.ts";
import { buildFallbackMediaItem } from "../media.ts";
import { collectSessionMediaPaths, type ProjectSession } from "../session.ts";
import { OPENING_SAMPLE_MANIFEST } from "./opening-manifest.generated.ts";
import { buildSampleOpenPayload } from "./sample-loader.ts";

const sessionText = readFileSync(
  new URL("./zvid-opening.project.json", import.meta.url),
  "utf8",
);
const session = JSON.parse(sessionText) as ProjectSession;
const FPS = 30;
const MUSIC_ID = "zvid-sample:opening-v2:music";
const AUDIO_LAYER = "audio";
const MUSIC_TRACK = "source-music";

// The handler types in an MP4, such as "vide" or "soun" for its tracks.
function mp4TrackKinds(bytes: Buffer) {
  const kinds = new Set<string>();
  for (
    let at = bytes.indexOf("hdlr");
    at >= 0;
    at = bytes.indexOf("hdlr", at + 4)
  ) {
    kinds.add(bytes.subarray(at + 12, at + 16).toString("latin1"));
  }
  return kinds;
}

function openSample() {
  const payload = buildSampleOpenPayload(OPENING_SAMPLE_MANIFEST, sessionText);
  const media = payload.mediaRefs.map((ref) =>
    buildFallbackMediaItem(ref, PALETTE[0]),
  );
  return { media, project: sessionToProject(payload.session, media) };
}

function effectsOn(trackId: string) {
  return (session.effects ?? []).filter((effect) => effect.trackId === trackId);
}

function stringParameter(
  effect: { parameters?: Record<string, { stringValue?: string }> },
  key: string,
) {
  return effect.parameters?.[key]?.stringValue;
}

function numberParameter(
  effect: { parameters?: Record<string, { floatValue?: number }> },
  key: string,
) {
  return effect.parameters?.[key]?.floatValue;
}

// The Audio layer's music selections, in time order.
function musicSelections() {
  return (session.selections ?? [])
    .filter((selection) => selection.mainTrackId === AUDIO_LAYER)
    .sort((left, right) => left.frameStart - right.frameStart);
}

function videoSelections() {
  return (session.selections ?? []).filter(
    (selection) => selection.mainTrackId !== AUDIO_LAYER,
  );
}

// The clips on a source track.
function spansOn(trackId: string) {
  return (session.clips ?? []).filter((clip) => clip.trackId === trackId);
}

// The layer clips covering `seconds`.
function clipsAt<Clip extends { frameStart: number; frameEnd: number }>(
  clips: Clip[] | undefined,
  seconds: number,
) {
  const frame = seconds * FPS;
  return (clips ?? []).filter(
    (clip) => clip.frameStart <= frame && frame < clip.frameEnd,
  );
}

describe("zvid opening sample", () => {
  it("is exactly 30 seconds at 30 fps and 1920×1080", () => {
    assert.deepEqual(
      {
        fps: session.timeline?.fps,
        width: session.timeline?.canvasWidth,
        height: session.timeline?.canvasHeight,
        duration: session.timeline?.projectDuration,
      },
      { fps: 30, width: 1920, height: 1080, duration: 900 },
    );
    const lastFrame = Math.max(
      ...(session.selections ?? []).map((selection) => selection.frameEnd),
      ...(session.fills ?? []).map((clip) => clip.frameEnd),
      ...(session.texts ?? []).map((clip) => clip.frameEnd),
      ...(session.fxClips ?? []).map((clip) => clip.frameEnd),
    );
    assert.equal(lastFrame, 900);
  });

  it("uses every registered video effect", () => {
    const used = new Set((session.effects ?? []).map((e) => e.effectName));
    const missing = FX_EFFECT_DEFINITIONS.filter(
      (definition) => (definition.domain ?? "video") === "video",
    )
      .map((definition) => definition.effectName)
      .filter((name) => !used.has(name));
    assert.deepEqual(missing, []);
  });

  // Color paints the fill clips and Opacity fades clips; every other Blur,
  // Distort, Glitch, Stylize or Color effect is shown off on a clip of its
  // own.
  it("puts each Blur, Distort, Glitch, Stylize and Color effect on a clip of its own", () => {
    const showcased = new Set(
      FX_EFFECT_DEFINITIONS.filter(
        (definition) =>
          definition.domain !== "audio" &&
          ["blur", "distort", "glitch", "stylize", "color"].includes(
            definition.category,
          ) &&
          definition.effectName !== "Color" &&
          definition.effectName !== "Opacity",
      ).map((definition) => definition.effectName),
    );
    const byClip = new Map<string, string[]>();
    for (const effect of session.effects ?? []) {
      if (
        effect.trackId.startsWith("clip:") &&
        showcased.has(effect.effectName)
      ) {
        byClip.set(effect.trackId, [
          ...(byClip.get(effect.trackId) ?? []),
          effect.effectName,
        ]);
      }
    }
    for (const [clip, names] of byClip) {
      assert.equal(names.length, 1, `${clip}: ${names.join(", ")}`);
    }
    // Distortion and Refraction show off every one of their types.
    const types = (effectName: string) =>
      new Set(
        (session.effects ?? [])
          .filter((effect) => effect.effectName === effectName)
          .map((effect) => stringParameter(effect, "_Type")),
      );
    assert.deepEqual([...types("Distortion")].sort(), [
      "Bulge",
      "Fisheye",
      "Ripple",
      "Turbulence",
      "Twirl",
      "Wave",
    ]);
    assert.deepEqual([...types("Refraction")].sort(), [
      "Frosted Glass",
      "Glass Blocks",
      "Reeded Glass",
      "Water",
    ]);
  });

  it("cuts three separate video layers every 1.5 s through the three-ups", () => {
    const videoLayers = new Set(
      videoSelections().map((selection) => selection.mainTrackId),
    );
    assert.deepEqual([...videoLayers].sort(), ["corridor", "orbit", "ribbon"]);
    for (const layer of videoLayers) {
      const starts = videoSelections()
        .filter((selection) => selection.mainTrackId === layer)
        .map((selection) => selection.frameStart / FPS);
      assert.ok(starts.includes(4.5), `${layer} cuts at 4.5 s`);
      assert.ok(starts.includes(16.5), `${layer} cuts at 16.5 s`);
    }
    // The panels' sources change order at the cuts.
    const sourceAt = (layer: string, seconds: number) =>
      (session.selections ?? []).find(
        (selection) =>
          selection.mainTrackId === layer &&
          selection.frameStart === seconds * FPS,
      )?.trackId;
    assert.notEqual(sourceAt("orbit", 3), sourceAt("orbit", 4.5));
  });

  it("trims four three-up panels to enter or leave while an Order runs", () => {
    // The layer's panel of the three-up cut at `cutSeconds`.
    const at = (layer: string, cutSeconds: number) =>
      videoSelections().find(
        (selection) =>
          selection.mainTrackId === layer &&
          selection.frameStart >= cutSeconds * FPS &&
          selection.frameStart < (cutSeconds + 1.5) * FPS,
      );
    const frameRange = (layer: string, cutSeconds: number) => {
      const selection = at(layer, cutSeconds);
      return [selection?.frameStart, selection?.frameEnd];
    };
    assert.deepEqual(frameRange("ribbon", 3), [101, 135]);
    assert.deepEqual(frameRange("corridor", 3), [113, 135]);
    assert.deepEqual(frameRange("ribbon", 4.5), [135, 169]);
    assert.deepEqual(frameRange("ribbon", 6), [191, 225]);
    // Trims, not slips: the source stays aligned with the timeline.
    assert.equal(at("ribbon", 3)?.sourceOffsetSeconds, 3.4);
    assert.equal(at("corridor", 3)?.sourceOffsetSeconds, 9.4);
    assert.equal(at("ribbon", 4.5)?.sourceOffsetSeconds, -2.9);
    assert.equal(at("ribbon", 6)?.sourceOffsetSeconds, 4);
    // The other panels of those three-ups keep their full 1.5 s.
    assert.deepEqual(frameRange("orbit", 3), [90, 135]);
    assert.deepEqual(frameRange("corridor", 4.5), [135, 180]);
  });

  it("pushes clips into Horizontal and Vertical Orders with per-clip spacing and margin", () => {
    const orders = (session.fxClips ?? [])
      .filter((clip) => clip.mainTrackId === "order")
      .map((clip) => {
        const [order] = effectsOn(`clip:${clip.id}`);
        assert.equal(order.effectName, "Order");
        assert.equal(
          stringParameter(order, "BorderColor"),
          "rgba(243,226,191,1)",
        );
        // The Audio layer's music takes no panel.
        assert.equal(
          stringParameter(order, "ExcludedLayers"),
          "background,audio",
        );
        assert.equal(numberParameter(order, "GridSize"), 2);
        assert.deepEqual(order.animation, {
          enabled: true,
          mode: "clip",
          // Without Motion In and Out marked as its own, an Order slides
          // Ease In Out both ways.
          clip: { timing: "Normal", transition: "Push" },
        });
        return [
          clip.frameStart / FPS,
          stringParameter(order, "Arrangement"),
          numberParameter(order, "Spacing"),
          numberParameter(order, "Margin"),
        ];
      });
    assert.deepEqual(orders, [
      [3, "Horizontal", 108, 108],
      [6, "Vertical", 108, 108],
      [9, "Horizontal", 108, 108],
      [15, "Horizontal", 108, 108],
      [18, "Vertical", 48, 12],
      [21, "Horizontal", 64, 0],
      [22.5, "Vertical", 50, 57],
      [24, "Horizontal", 0, 108],
      [25.5, "Vertical", 0, 108],
    ]);
    // No Order over the full-frame shots and the title card.
    for (const seconds of [0.5, 2, 13, 28]) {
      assert.deepEqual(
        clipsAt(session.fxClips, seconds).filter(
          (clip) => clip.mainTrackId === "order",
        ),
        [],
      );
    }
  });

  it("transitions across the cuts at bars 5, 6 and 7", () => {
    const transitions = (session.fxClips ?? []).filter(
      (clip) => clip.mainTrackId === "transitions",
    );
    // A Glitch at bar 5 (12 s), a Ripple at bar 6 (15 s) and a Dissolve at
    // bar 7 (18 s), each centered on its cut.
    assert.deepEqual(
      transitions.map((clip) => {
        const [effect] = effectsOn(`clip:${clip.id}`);
        return [
          clip.frameStart / FPS,
          clip.frameEnd / FPS,
          effect.effectName,
          stringParameter(effect, "Type"),
          numberParameter(effect, "Softness"),
        ];
      }),
      // Every transition is hard-edged.
      [
        [11.5, 12.5, "Transition", "Glitch", 0],
        [14.5, 15.5, "Transition", "Ripple", 0],
        [17.5, 18.5, "Transition", "Dissolve", 0],
      ],
    );
    // Layer 1, so every transition renders above the titles and the other
    // FX layers, and the arranged three-up below it is one comp.
    const layerIds = (session.mainTracks ?? []).map((layer) => layer.id);
    assert.equal(layerIds[0], "transitions");
    // The Glitch carries no Push-only Direction.
    const [glitch] = effectsOn(`clip:${transitions[0].id}`);
    assert.equal(glitch.parameters?.Direction, undefined);
  });

  it("opens the 1.5 s orbit shot out of the zvid logo on a hidden layer", () => {
    const masksLayer = session.mainTracks?.find(
      (layer) => layer.id === "masks",
    );
    assert.equal(masksLayer?.hidden, true);
    // One hidden layer holds every mask shape.
    assert.deepEqual(
      (session.mainTracks ?? [])
        .filter((layer) => layer.hidden)
        .map((layer) => layer.id),
      ["masks"],
    );
    // A one-beat reveal, then a one-beat hold, so the mask has a Target for
    // the whole shot. A beat is 22.5 frames, so the cut rounds to frame 68.
    const icons = (session.fills ?? []).filter(
      (clip) => clip.mainTrackId === "masks" && clip.id.startsWith("fill-logo"),
    );
    assert.deepEqual(
      icons.map((clip) => [clip.id, clip.frameStart, clip.frameEnd]),
      [
        ["fill-logo-reveal", 45, 68],
        ["fill-logo-hold", 68, 90],
      ],
    );
    const [revealEffects, holdEffects] = icons.map((clip) =>
      effectsOn(`clip:${clip.id}`),
    );
    assert.deepEqual(
      revealEffects.map((effect) => effect.effectName),
      ["Color", "Shape", "Move", "DigitalGlitch"],
    );
    assert.deepEqual(
      holdEffects.map((effect) => effect.effectName),
      ["Color", "Shape", "Transform"],
    );
    // The logo glitches as it pops open, a free-running 1 Hz Sine LFO on
    // its Amount.
    const glitch = revealEffects[3];
    assert.deepEqual(
      Object.fromEntries(
        Object.keys(glitch.parameters ?? {}).map((key) => [
          key,
          numberParameter(glitch, key),
        ]),
      ),
      {
        _Amount: 0.04,
        _BlockSize: 0.1,
        _Displace: 0.15,
        _ChannelShift: 0.3,
        _ColorCrush: 0,
        _Rate: 8,
      },
    );
    assert.equal(glitch.animation?.enabled, true);
    assert.equal(glitch.animation?.mode, "lfo");
    assert.deepEqual(glitch.animation?.lfo, {
      shape: "Sine",
      sync: false,
      rate: 1,
      syncRate: "1 Bar",
      depth: 0.6,
      phase: 0,
      parameters: ["_Amount"],
    });
    // It loads exactly as saved.
    assert.deepEqual(
      normalizeEffectAnimation(glitch.animation, "DigitalGlitch"),
      glitch.animation,
    );
    const logo = OPENING_SAMPLE_MANIFEST.assets.find(
      (asset) => asset.name === "zvid-logo.svg",
    );
    assert.equal(logo?.mediaType, "image/svg+xml");
    assert.equal(
      OPENING_SAMPLE_MANIFEST.assets.some((asset) =>
        asset.name.includes("movie-camera"),
      ),
      false,
    );
    for (const effects of [revealEffects, holdEffects]) {
      assert.equal(
        stringParameter(effects[1], "Shape"),
        `Custom:${logo?.path}`,
      );
    }
    // The reveal pops open fast, and the hold stays where it ends.
    const move = revealEffects[2];
    const hold = holdEffects[2];
    assert.equal(stringParameter(move, "Motion"), "Ease Out");
    for (const key of ["PositionX", "PositionY", "ScaleX", "ScaleY"]) {
      assert.equal(
        numberParameter(hold, key),
        numberParameter(move, `End${key}`),
      );
    }
    // The logo grows from small, in its 258 × 212 aspect on the 16:9
    // canvas (the Custom shape stretches its viewBox over the box), until
    // the whole logo nearly fills the frame, centered and uncropped.
    for (const end of ["Start", "End"]) {
      assert.equal(
        (
          ((numberParameter(move, `${end}ScaleX`) ?? 0) * 1920) /
          ((numberParameter(move, `${end}ScaleY`) ?? 1) * 1080)
        ).toFixed(3),
        (258 / 212).toFixed(3),
      );
    }
    assert.ok((numberParameter(move, "StartScaleY") ?? 1) < 0.5);
    const boxWidth = (numberParameter(move, "EndScaleX") ?? 0) * 1920;
    const boxHeight = (numberParameter(move, "EndScaleY") ?? 0) * 1080;
    assert.equal(numberParameter(move, "EndPositionX") ?? 0, 0);
    assert.equal(numberParameter(move, "EndPositionY") ?? 0, 0);
    // The logo's shapes span x 2–241 and y 2–194 of its viewBox
    // (-8 -8 258 212).
    const logoLeft = 960 - boxWidth / 2 + (10 / 258) * boxWidth;
    const logoRight = 960 - boxWidth / 2 + (249 / 258) * boxWidth;
    const logoTop = 540 - boxHeight / 2 + (10 / 212) * boxHeight;
    const logoBottom = 540 - boxHeight / 2 + (202 / 212) * boxHeight;
    assert.ok(logoLeft > 0 && logoRight < 1920);
    assert.ok(logoTop > 0 && logoBottom < 1080);
    assert.ok(logoBottom - logoTop > 0.75 * 1080);
    // The art is the zvid logo: the film ribbon Z, with its sprocket holes
    // cut out of the top and bottom strips.
    const art = readFileSync(
      new URL(`../../public${logo?.url}`, import.meta.url),
      "utf8",
    );
    assert.match(art, /viewBox="-8 -8 258 212"/);
    assert.equal((art.match(/<path/g) ?? []).length, 3);
    assert.equal((art.match(/fill-rule="evenodd"/g) ?? []).length, 2);

    // The full-frame orbit shot under "capture", with no three-up, is
    // masked by it; the title above it is not.
    const [shot] = clipsAt(videoSelections(), 2);
    assert.equal(shot.mainTrackId, "orbit");
    assert.deepEqual([shot.frameStart / FPS, shot.frameEnd / FPS], [1.5, 3]);
    const mask = effectsOn(`clip:selection-${shot.id}`).find(
      (effect) => effect.effectName === "Mask",
    );
    assert.ok(mask);
    assert.equal(stringParameter(mask, "Target"), "masks");
    assert.equal(stringParameter(mask, "Mode"), "Additive");
    const layerIds = (session.mainTracks ?? []).map((layer) => layer.id);
    assert.ok(layerIds.indexOf("title-words") < layerIds.indexOf("masks"));

    // The logo is the only mask shape on the hidden layer during the shot.
    assert.deepEqual(
      clipsAt(
        [...(session.fills ?? [])].filter(
          (clip) => clip.mainTrackId === "masks",
        ),
        2,
      ).map((clip) => clip.id),
      ["fill-logo-reveal"],
    );
  });

  it("shares one hidden layer between the logo and star masks", () => {
    const shapes = [
      ...(session.fills ?? []),
      ...(session.texts ?? []),
      ...(session.fxClips ?? []),
      ...(session.selections ?? []),
    ].filter((clip) => clip.mainTrackId === "masks");
    const masked = [
      ...(session.selections ?? []).map((clip) => ({
        ...clip,
        trackId: `clip:selection-${clip.id}`,
      })),
      ...(session.fxClips ?? []).map((clip) => ({
        ...clip,
        trackId: `clip:${clip.id}`,
      })),
    ];
    // Each Mask sees only its own shapes: the logo's two clips or the star.
    const targets = (session.effects ?? [])
      .filter(
        (effect) =>
          effect.effectName === "Mask" &&
          stringParameter(effect, "Target") === "masks",
      )
      .map((effect) => {
        const clip = masked.find((each) => each.trackId === effect.trackId);
        assert.ok(clip, `${effect.trackId} is a clip`);
        return shapes
          .filter(
            (shape) =>
              shape.frameStart < clip.frameEnd &&
              clip.frameStart < shape.frameEnd,
          )
          .map((shape) => String(shape.id));
      });
    assert.deepEqual(targets, [
      ["fill-logo-reveal", "fill-logo-hold"],
      ["fill-star-mask"],
    ]);
    assert.deepEqual(shapes.map((shape) => String(shape.id)).sort(), [
      "fill-logo-hold",
      "fill-logo-reveal",
      "fill-star-mask",
    ]);
  });

  it("keeps no layer effects, with the corridor's Layout on its clips", () => {
    const layerIds = new Set(
      (session.mainTracks ?? []).map((layer) => layer.id),
    );
    assert.deepEqual(
      (session.effects ?? []).filter((effect) => layerIds.has(effect.trackId)),
      [],
    );
    // Opened, every layer has its Center Layout, and every clip anchors as
    // it always has: the corridor's at the bottom, everything else centered.
    const { project } = openSample();
    for (const lane of project.lanes) {
      const layouts = project.effects.filter(
        (effect) =>
          effect.trackId === lane.id && effect.effectName === "Layout",
      );
      assert.equal(layouts.length, 1, `${lane.id} has one Layout`);
      assert.equal(
        layouts[0].parameters.find((parameter) => parameter.key === "Position")
          ?.value,
        "Center",
        `${lane.id} Layout`,
      );
    }
    const laneIds = new Set(project.lanes.map((lane) => lane.id));
    const clips = project.arrangementClips.filter(
      (clip) => laneIds.has(clip.laneId) && clip.kind !== "fx",
    );
    assert.ok(clips.some((clip) => clip.laneId === "corridor"));
    for (const clip of clips) {
      assert.equal(
        resolveVisualState(project.effects, clip.laneId, clip.id).layoutAnchor,
        clip.laneId === "corridor" ? "bottom" : "center",
        `${clip.id} on ${clip.laneId}`,
      );
    }
  });

  it("limits Pixelate, Negative Split and Analog Glitch to boxes that move differently", () => {
    const regions = (session.fxClips ?? []).filter(
      (clip) => clip.mainTrackId === "fx-regions",
    );
    assert.deepEqual(
      regions.map((clip) => [
        clip.frameStart / FPS,
        effectsOn(`clip:${clip.id}`).map((effect) => effect.effectName),
      ]),
      [
        [12, ["Pixelate", "Move", "Transform"]],
        [15, ["NegativeSplit", "Move", "Transform"]],
        [18, ["AnalogGlitch", "Mask"]],
      ],
    );
    const [pixelate, negativeSplit, analogGlitch] = regions.map((clip) =>
      effectsOn(`clip:${clip.id}`),
    );

    // Pixelate's box sweeps left to right, turning from -16° to +16°.
    const [, sweep, box] = pixelate;
    assert.equal(numberParameter(box, "ScaleX"), 0.3);
    assert.equal(numberParameter(box, "ScaleY"), 0.56);
    assert.equal(numberParameter(sweep, "StartRotation"), -16);
    assert.equal(numberParameter(sweep, "EndRotation"), 16);
    assert.ok(
      (numberParameter(sweep, "StartPositionX") ?? 0) <
        (numberParameter(sweep, "EndPositionX") ?? 0),
    );

    // Negative Split's wide band drops down the frame (+Y is down), breathing on each
    // beat with a quarter-note LFO on its Height.
    const [, drop, band] = negativeSplit;
    assert.equal(stringParameter(drop, "Motion"), "Ease Out");
    assert.equal(numberParameter(drop, "StartPositionX"), 0);
    assert.equal(numberParameter(drop, "EndPositionX"), 0);
    assert.ok(
      (numberParameter(drop, "StartPositionY") ?? 0) <
        (numberParameter(drop, "EndPositionY") ?? 0),
    );
    assert.ok(
      (numberParameter(band, "ScaleX") ?? 0) >
        (numberParameter(band, "ScaleY") ?? 0),
    );
    assert.equal(band.animation?.enabled, true);
    assert.equal(band.animation?.mode, "lfo");
    assert.equal(band.animation?.lfo?.sync, true);
    assert.equal(band.animation?.lfo?.syncRate, "1/4");
    assert.deepEqual(band.animation?.lfo?.parameters, ["ScaleY"]);

    // Analog Glitch applies inside a spinning, growing star on the hidden
    // Masks layer.
    const mask = analogGlitch[1];
    assert.equal(stringParameter(mask, "Target"), "masks");
    assert.equal(stringParameter(mask, "Mode"), "Additive");
    const stars = (session.fills ?? []).filter(
      (clip) => clip.mainTrackId === "masks" && clip.id === "fill-star-mask",
    );
    assert.deepEqual(
      stars.map((clip) => [clip.frameStart / FPS, clip.frameEnd / FPS]),
      [[18, 21]],
    );
    const starEffects = effectsOn(`clip:${stars[0].id}`);
    assert.deepEqual(
      starEffects.map((effect) => effect.effectName),
      ["Color", "Shape", "Move"],
    );
    assert.equal(stringParameter(starEffects[1], "Shape"), "Star");
    const spin = starEffects[2];
    assert.equal(stringParameter(spin, "Motion"), "Linear");
    assert.ok(
      (numberParameter(spin, "StartRotation") ?? 0) <
        (numberParameter(spin, "EndRotation") ?? 0),
    );
    assert.ok(
      (numberParameter(spin, "StartScaleY") ?? 0) <
        (numberParameter(spin, "EndScaleY") ?? 0),
    );
  });

  it("slams 'edit' in and winds 'repeat' across, both under Motion Blur", () => {
    const textClip = (id: string) => {
      const clip = (session.texts ?? []).find(
        (candidate) => candidate.id === id,
      );
      assert.ok(clip, id);
      return {
        span: [clip.frameStart, clip.frameEnd],
        effects: effectsOn(`clip:${id}`),
      };
    };

    // On bar 5's second beat, after the Glitch transition, "edit" flies in
    // from just off the left edge, smeared along its flight until it lands,
    // then holds there.
    const slam = textClip("text-edit-slam");
    const hold = textClip("text-edit");
    assert.deepEqual(slam.span, [383, 396]);
    assert.deepEqual(hold.span, [396, 450]);
    assert.deepEqual(
      slam.effects.map((effect) => effect.effectName),
      ["Text", "Move", "MotionBlur"],
    );
    const [slamText, flight, smear] = slam.effects;
    assert.equal(stringParameter(slamText, "Text"), "edit");
    assert.equal(stringParameter(flight, "Motion"), "Ease Out");
    assert.equal(numberParameter(flight, "StartPositionX"), -0.3);
    assert.equal(numberParameter(flight, "EndPositionX"), 0);
    assert.equal(
      numberParameter(flight, "EndPositionY"),
      numberParameter(hold.effects[1], "PositionY"),
    );
    assert.equal(numberParameter(smear, "_Angle"), 0);
    assert.ok((numberParameter(smear, "_Distance") ?? 0) > 0);
    assert.equal(smear.animation?.mode, "clip");
    assert.equal(smear.animation?.clip?.motionIn, "None");
    assert.notEqual(smear.animation?.clip?.motionOut, "None");

    // "repeat" crosses right to left at a steady speed, winding up and
    // down through four waypoints on a curve, smeared along its flight.
    const glide = textClip("text-repeat");
    assert.deepEqual(glide.span, [630, 720]);
    assert.deepEqual(
      glide.effects.map((effect) => effect.effectName),
      ["Text", "Move", "MotionBlur"],
    );
    const [, cross, trail] = glide.effects;
    assert.equal(stringParameter(cross, "Motion"), "Linear");
    assert.equal(stringParameter(cross, "Waypoints"), "4");
    assert.equal(stringParameter(cross, "Path"), "Curve");
    const xs = ["Start", "Point1", "Point2", "Point3", "Point4", "End"].map(
      (prefix) => numberParameter(cross, `${prefix}PositionX`) ?? 0,
    );
    const ys = ["Start", "Point1", "Point2", "Point3", "Point4", "End"].map(
      (prefix) => numberParameter(cross, `${prefix}PositionY`) ?? 0,
    );
    for (let index = 1; index < xs.length; index++) {
      assert.ok(xs[index] < xs[index - 1], `x ${index}`);
    }
    // The path turns back on itself vertically at every waypoint.
    for (let index = 1; index < ys.length - 1; index++) {
      assert.ok(
        (ys[index] - ys[index - 1]) * (ys[index + 1] - ys[index]) < 0,
        `y ${index}`,
      );
    }
    assert.equal(numberParameter(trail, "_Angle"), 0);
    assert.ok((numberParameter(trail, "_Distance") ?? 0) > 0);
  });

  it("uses no Gaussian Blur where a directional smear is meant", () => {
    const blurred = (session.effects ?? [])
      .filter((effect) => effect.effectName === "GaussianBlur")
      .map((effect) => effect.trackId);
    // Only the bar 2 focus pull.
    assert.equal(blurred.length, 1);
    const texts = new Set(
      (session.texts ?? []).map((clip) => clipEffectTrackId(clip.id)),
    );
    assert.equal(
      blurred.some((trackId) => texts.has(trackId)),
      false,
    );
  });

  it("circles bar 7's star with two counter-rotating rings of words", () => {
    const rings = ["text-ring-outer", "text-ring-inner"].map((id) => {
      const clip = (session.texts ?? []).find(
        (candidate) => candidate.id === id,
      );
      assert.ok(clip, id);
      assert.deepEqual([clip.frameStart, clip.frameEnd], [540, 630]);
      const effects = effectsOn(`clip:${id}`);
      assert.deepEqual(
        effects.map((effect) => effect.effectName),
        ["Text", "Move"],
      );
      const [words, spin] = effects;
      assert.equal(stringParameter(words, "Path"), "Circle");
      assert.equal(stringParameter(words, "Align"), "Justify");
      assert.equal(stringParameter(spin, "Motion"), "Linear");
      assert.equal(numberParameter(spin, "StartRotation"), 0);
      return {
        layer: clip.mainTrackId,
        radius: numberParameter(words, "PathRadius") ?? 0,
        turn: numberParameter(spin, "EndRotation") ?? 0,
      };
    });
    const [outer, inner] = rings;
    assert.notEqual(outer.layer, inner.layer);
    assert.ok(outer.radius > inner.radius);
    assert.ok(outer.turn * inner.turn < 0);
  });

  it("blooms a dot into a dashed ring round the wordmark on one layer", () => {
    const fill = (id: string) => {
      const clip = (session.fills ?? []).find(
        (candidate) => candidate.id === id,
      );
      assert.ok(clip, id);
      return clip;
    };
    const core = fill("fill-bloom-core");
    const ring = fill("fill-bloom-ring");
    const outro = fill("fill-bloom-ring-outro");
    // The whole bloom costs one layer, and nothing else draws on it.
    const bloomLayers = (session.mainTracks ?? [])
      .map((layer) => layer.id)
      .filter((id) => id.includes("bloom"));
    assert.deepEqual(bloomLayers, [core.mainTrackId]);
    const onLayer = (session.fills ?? [])
      .filter((clip) => clip.mainTrackId === core.mainTrackId)
      .map((clip) => clip.id);
    assert.deepEqual(onLayer, [core.id, ring.id, outro.id]);
    // It runs unbroken from 24 s to the last frame: the sample's ending.
    assert.deepEqual([core.frameStart, core.frameEnd], [720, 732]);
    assert.deepEqual([ring.frameStart, ring.frameEnd], [732, 810]);
    assert.deepEqual([outro.frameStart, outro.frameEnd], [810, 900]);

    const [coreMove] = effectsOn(`clip:${core.id}`).filter(
      (effect) => effect.effectName === "Move",
    );
    assert.equal(numberParameter(coreMove, "StartScaleX"), 0);
    const coreSize = numberParameter(coreMove, "EndScaleX") ?? 0;
    assert.ok(coreSize > 0);

    // The ring draws itself on with its dashes marching in, then at the
    // hard cut to the card turns ink and widens out as its dashes withdraw.
    // It turns at one steady speed across both clips, never sitting still.
    const ringEffects = (id: string) => {
      const effects = effectsOn(`clip:${id}`);
      const shape = effects.find((effect) => effect.effectName === "Shape");
      const spin = effects.find((effect) => effect.effectName === "Move");
      assert.ok(shape && spin, id);
      assert.equal(stringParameter(shape, "Shape"), "Oval");
      assert.ok((numberParameter(shape, "StrokeWidth") ?? 0) > 0);
      assert.ok((numberParameter(shape, "DashLength") ?? 0) > 0);
      assert.ok((numberParameter(shape, "DashOffset") ?? 0) !== 0);
      assert.equal(shape.animation?.mode, "clip");
      assert.equal(stringParameter(spin, "Motion"), "Linear");
      return { shape, spin };
    };
    const drawOn = ringEffects(ring.id);
    const exit = ringEffects(outro.id);
    assert.equal(drawOn.shape.animation?.clip?.motionOut, "None");
    assert.equal(exit.shape.animation?.clip?.motionIn, "None");
    assert.notEqual(exit.shape.animation?.clip?.motionOut, "None");

    // The ring opens out of the core over its Move's first leg, then holds
    // its circle while every leg turns it alike.
    const spin = drawOn.spin;
    assert.equal(stringParameter(spin, "Waypoints"), "4");
    const legs = ["Start", "Point1", "Point2", "Point3", "Point4", "End"];
    const full = numberParameter(spin, "EndScaleY") ?? 0;
    const startScaleX = numberParameter(spin, "StartScaleX") ?? 0;
    assert.ok(startScaleX >= 0.05 && startScaleX < coreSize);
    assert.ok((numberParameter(spin, "StartScaleY") ?? 0) < full);
    for (const prefix of legs.slice(1)) {
      assert.equal(numberParameter(spin, `${prefix}ScaleY`), full, prefix);
    }
    const turns = legs.map(
      (prefix) => numberParameter(spin, `${prefix}Rotation`) ?? 0,
    );
    const leg = turns[1] - turns[0];
    assert.ok(leg > 0);
    for (let index = 1; index < turns.length; index++) {
      assert.ok(Math.abs(turns[index] - turns[index - 1] - leg) < 1e-6);
    }
    const speed = (effect: typeof spin, clip: typeof ring) =>
      (((numberParameter(effect, "EndRotation") ?? 0) -
        (numberParameter(effect, "StartRotation") ?? 0)) *
        FPS) /
      (clip.frameEnd - clip.frameStart);
    assert.ok(Math.abs(speed(exit.spin, outro) - speed(spin, ring)) < 1e-6);
    assert.equal(
      numberParameter(exit.spin, "StartRotation"),
      numberParameter(spin, "EndRotation"),
    );
    // The outro widens the circle it was handed.
    assert.equal(numberParameter(exit.spin, "StartScaleY"), full);
    assert.ok((numberParameter(exit.spin, "EndScaleY") ?? 0) > full);
  });

  it("has no vortex layers or clips", () => {
    const ids = [
      ...(session.mainTracks ?? []).map((layer) => layer.id),
      ...(session.fills ?? []).map((clip) => clip.id),
    ];
    assert.deepEqual(
      ids.filter((id) => id.includes("vortex")),
      [],
    );
  });

  it("colors the reactive passages with audio-driven Colorize", () => {
    const colorized = (session.effects ?? []).filter(
      (effect) => effect.effectName === "Colorize",
    );
    assert.ok(colorized.length >= 12);
    for (const effect of colorized) {
      assert.equal(effect.animation?.mode, "reactive");
      assert.equal(effect.animation?.enabled, true);
      assert.equal(effect.animation?.reactive?.reactivity, 1);
      assert.equal(effect.animation?.reactive?.amplitude, 1);
      assert.deepEqual(effect.animation?.reactive?.parameters, ["_HueOffset"]);
    }
  });

  it("holds the ivory title card for the last three seconds", () => {
    const [card] = clipsAt(session.fills, 28).filter(
      (clip) => clip.mainTrackId === "background",
    );
    assert.ok(card);
    assert.equal(card.frameEnd - card.frameStart, 90);
    assert.deepEqual(
      effectsOn(`clip:${card.id}`).map((effect) => effect.effectName),
      ["Color", "Caustics", "Mask"],
    );
    // The wordmark is knocked out of the card.
    const mask = effectsOn(`clip:${card.id}`)[2];
    assert.equal(stringParameter(mask, "Target"), "title-wordmark");
    assert.equal(stringParameter(mask, "Mode"), "Subtractive");
    const texts = clipsAt(session.texts, 28).map((clip) =>
      stringParameter(effectsOn(`clip:${clip.id}`)[0], "Text"),
    );
    assert.deepEqual(texts.sort(), ["capture, edit, repeat", "zvid"]);
  });

  it("refers only to manifest assets, whose files match their hashes", () => {
    const paths = collectSessionMediaPaths(session);
    const assetPaths = OPENING_SAMPLE_MANIFEST.assets.map(
      (asset) => asset.path,
    );
    assert.deepEqual([...paths].sort(), [...assetPaths].sort());
    for (const asset of OPENING_SAMPLE_MANIFEST.assets) {
      const bytes = readFileSync(
        new URL(`../../public${asset.url}`, import.meta.url),
      );
      assert.equal(bytes.length, asset.bytes, asset.name);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        asset.sha256,
        asset.name,
      );
    }
  });

  it("holds one clip on each source track, looping its media to 30 s, which its cuts slip to their in-points", () => {
    const tracks = session.tracks ?? [];
    assert.equal(tracks.length, 4);
    assert.equal((session.clips ?? []).length, tracks.length);
    const { project } = openSample();
    for (const track of tracks.filter((track) => track.id !== MUSIC_TRACK)) {
      const spans = spansOn(track.id);
      assert.equal(spans.length, 1, track.id);
      const [span] = spans;
      assert.equal(span.frameStart, 0, track.id);
      assert.equal(span.clipStart, 0, track.id);
      // The clip runs the whole project, past its 16 s of media, which
      // loops.
      assert.equal(span.frameCount, 30 * FPS, track.id);
      assert.equal(span.filePath, track.recordings?.[0]?.filename, track.id);

      // Each cut names the clip and plays it from its own in-point.
      const sourceSpan = project.sourceSpans.find(
        (candidate) => candidate.sourceTrackId === track.id,
      );
      assert.equal(sourceSpan?.durationSeconds, 30, track.id);
      for (const selection of videoSelections().filter(
        (candidate) => candidate.trackId === track.id,
      )) {
        assert.equal(selection.sourceClipId, span.id);
        const clip = project.arrangementClips.find(
          (candidate) => candidate.id === `selection-${selection.id}`,
        );
        assert.equal(clip?.sourceSpanId, sourceSpan?.id);
        const inSeconds =
          selection.frameStart / FPS + (selection.sourceOffsetSeconds ?? 0);
        assert.ok(
          Math.abs((clip?.trimStartSeconds ?? -1) - inSeconds) < 1e-9,
          clip?.id,
        );
        assert.ok(inSeconds >= 0, clip?.id);
        assert.ok(
          inSeconds * FPS + selection.frameEnd - selection.frameStart <=
            span.frameCount + 1e-6,
          clip?.id,
        );
      }
    }
  });

  it("plays its music from the Audio layer as two-beat selections and a bar", () => {
    assert.equal(session.audioFilename, undefined);
    assert.equal(session.audioGainDefaulted, true);
    assert.equal(session.mainTracks?.at(-1)?.id, AUDIO_LAYER);
    const musicPath = OPENING_SAMPLE_MANIFEST.assets.find(
      (asset) => asset.id === MUSIC_ID,
    )?.path;
    const track = (session.tracks ?? []).find(
      (candidate) => candidate.id === MUSIC_TRACK,
    );
    assert.equal(track?.name, "Music");
    assert.deepEqual(track?.recordings, [{ filename: musicPath }]);

    // The source track holds the whole music as one clip.
    const spans = spansOn(MUSIC_TRACK);
    assert.equal(spans.length, 1);
    const [span] = spans;
    assert.equal(span.filePath, musicPath);
    assert.equal(span.frameStart, 0);
    assert.equal(span.clipStart, 0);
    assert.equal(span.frameCount, 30 * FPS);

    // Back to back from 0 to 30 s, two beats each but a whole bar at bar 7
    // (18–21 s), each playing the music where it is in the file.
    const selections = musicSelections();
    assert.equal(selections.length, 19);
    let frame = 0;
    for (const selection of selections) {
      assert.equal(selection.trackId, MUSIC_TRACK);
      assert.equal(selection.frameStart, frame);
      assert.equal(
        selection.frameEnd - selection.frameStart,
        (frame === 18 * FPS ? 3 : 1.5) * FPS,
      );
      assert.equal(selection.sourceClipId, undefined);
      frame = selection.frameEnd;
    }
    assert.equal(frame, 30 * FPS);
  });

  it("gives each music selection a 0 dB Gain and an audio effect of its own", () => {
    const audioEffectNames = new Set(
      FX_EFFECT_DEFINITIONS.filter(
        (definition) => definition.domain === "audio",
      ).map((definition) => definition.effectName),
    );
    const shown: string[] = [];
    for (const selection of musicSelections()) {
      const clip = `selection-${selection.id}`;
      const [gain, ...others] = effectsOn(clipEffectTrackId(clip));
      assert.equal(gain.effectName, "Gain", clip);
      assert.equal(gain.enabled !== false, true, clip);
      assert.equal(numberParameter(gain, "Gain"), 0, clip);
      assert.equal(numberParameter(gain, "Mute"), 0, clip);
      // Re-Pitch shares Reverse's selection, and Delay follows the bar-7
      // Phaser; the rest have one each.
      assert.ok(
        others.length <= 1 ||
          ["Reverse,Re-Pitch", "Phaser,Delay"].includes(
            others.map((effect) => effect.effectName).join(),
          ),
        clip,
      );
      for (const effect of others) {
        assert.ok(audioEffectNames.has(effect.effectName), effect.effectName);
        shown.push(effect.effectName);
      }
    }
    // The first two beats are clean, and every other audio effect but the
    // Noise Gate, Stereo and Mono is heard.
    const [first] = musicSelections();
    assert.equal(
      effectsOn(clipEffectTrackId(`selection-${first.id}`)).length,
      1,
    );
    assert.deepEqual(
      [...new Set(shown)].sort(),
      [...audioEffectNames]
        .filter(
          (name) => !["Gain", "Noise Gate", "Stereo", "Mono"].includes(name),
        )
        .sort(),
    );
    // Audio effects are only on the music's selections.
    const musicClips = new Set(
      musicSelections().map((selection) =>
        clipEffectTrackId(`selection-${selection.id}`),
      ),
    );
    for (const effect of session.effects ?? []) {
      if (audioEffectNames.has(effect.effectName)) {
        assert.ok(musicClips.has(effect.trackId), effect.id);
      }
    }
  });

  it("sweeps bar 7's music through a Phaser into a Delay", () => {
    const bar = musicSelections().find(
      (selection) => selection.frameStart === 18 * FPS,
    );
    assert.equal(bar?.frameEnd, 21 * FPS);
    const [, phaser, delay] = effectsOn(
      clipEffectTrackId(`selection-${bar?.id}`),
    );
    assert.equal(phaser.effectName, "Phaser");
    assert.equal(stringParameter(phaser, "Stages"), "12");
    assert.deepEqual(
      ["Rate", "Depth", "Center", "Feedback", "Mix"].map((key) =>
        numberParameter(phaser, key),
      ),
      [0.33, 100, 1000, 79, 77],
    );
    assert.equal(delay.effectName, "Delay");
    assert.deepEqual(
      ["Sync", "Note", "Ping-pong"].map((key) => stringParameter(delay, key)),
      ["On", "1/8D", "Off"],
    );
    assert.deepEqual(
      ["Feedback", "High cut", "Mix"].map((key) => numberParameter(delay, key)),
      [0.35, 8000, 0.3],
    );
  });

  it("re-pitches bar 8's music up 8 semitones with its formants kept", () => {
    const bar8 = musicSelections().filter(
      (selection) =>
        selection.frameStart >= 21 * FPS && selection.frameStart < 24 * FPS,
    );
    const names = bar8.flatMap((selection) =>
      effectsOn(clipEffectTrackId(`selection-${selection.id}`))
        .slice(1)
        .map((effect) => effect.effectName),
    );
    assert.ok(!names.includes("Noise Gate"), names.join());
    const [first] = bar8;
    assert.equal(first.frameStart, 21 * FPS);
    const [, rePitch] = effectsOn(clipEffectTrackId(`selection-${first.id}`));
    assert.equal(rePitch.effectName, "Re-Pitch");
    assert.equal(stringParameter(rePitch, "Algorithm"), "Formants");
    assert.equal(numberParameter(rePitch, "Semitones"), 8);
    assert.equal(numberParameter(rePitch, "Cents"), 0);
    assert.equal(numberParameter(rePitch, "Formants"), 1);
  });

  // The mix plays the layer clips with sound: the Audio layer's music.
  it("has video-only sources and an audio-only music file", () => {
    for (const asset of OPENING_SAMPLE_MANIFEST.assets.filter((candidate) =>
      /^(audio|video)\//.test(candidate.mediaType),
    )) {
      const bytes = readFileSync(
        new URL(`../../public${asset.url}`, import.meta.url),
      );
      const kinds = mp4TrackKinds(bytes);
      const isMusic = asset.id === MUSIC_ID;
      assert.deepEqual(
        { sound: kinds.has("soun"), video: kinds.has("vide") },
        { sound: isMusic, video: !isMusic },
        asset.name,
      );
    }
  });

  it("credits its music in the manifest and CREDITS.md", () => {
    const music = OPENING_SAMPLE_MANIFEST.assets.find(
      (asset) => asset.id === MUSIC_ID,
    );
    assert.equal(music?.name, "just-nasty-30s.m4a");
    assert.match(
      music?.credit ?? "",
      /^"Just Nasty" by Kevin MacLeod \(incompetech\.com\), licensed under CC BY 4\.0 /,
    );
    const credits = readFileSync(
      new URL(
        `../../public${OPENING_SAMPLE_MANIFEST.creditsUrl}`,
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(
      credits,
      /^"Just Nasty" by Kevin MacLeod \(incompetech\.com\)$/m,
    );
    assert.match(credits, /^`just-nasty-30s\.m4a` is the excerpt/m);
  });

  it("credits its mask as zvid's own logo in the manifest and CREDITS.md", () => {
    const logo = OPENING_SAMPLE_MANIFEST.assets.find(
      (asset) => asset.name === "zvid-logo.svg",
    );
    assert.equal(logo?.credit, "The zvid logo, zvid's own artwork.");
    const credits = readFileSync(
      new URL(
        `../../public${OPENING_SAMPLE_MANIFEST.creditsUrl}`,
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(credits, /^`zvid-logo\.svg` is the zvid logo/m);
    assert.doesNotMatch(credits, /movie-camera|game-icons|Attribution 3\.0/);
  });

  it("grades a panel with its own LUT, credited in the manifest and CREDITS.md", () => {
    const lut = OPENING_SAMPLE_MANIFEST.assets.find(
      (asset) => asset.name === "warm-film.cube",
    );
    assert.match(
      lut?.credit ?? "",
      /^An original warm film grade made for zvid/,
    );
    const graded = (session.effects ?? []).filter(
      (effect) => effect.effectName === "LUT",
    );
    assert.equal(graded.length, 1);
    assert.equal(stringParameter(graded[0], "LUT"), `Custom:${lut?.path}`);
    assert.deepEqual(
      collectSessionMediaPaths(session).includes(lut?.path ?? ""),
      true,
    );
    const cube = parseCubeLut(
      readFileSync(new URL(`../../public${lut?.url}`, import.meta.url), "utf8"),
    );
    assert.equal(cube.size, 17);
    const credits = readFileSync(
      new URL(
        `../../public${OPENING_SAMPLE_MANIFEST.creditsUrl}`,
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(credits, /^`warm-film\.cube` is an original warm film grade/m);
  });

  // The mask's Color effect paints the logo, so its own fill only shows in
  // thumbnails, where the dark logo stands out on the light checkerboard.
  it("ships the dark zvid logo", () => {
    const logo = OPENING_SAMPLE_MANIFEST.assets.find(
      (asset) => asset.name === "zvid-logo.svg",
    );
    const svg = readFileSync(
      new URL(`../../public${logo?.url}`, import.meta.url),
      "utf8",
    );
    const root = svg.match(/^<svg\b[^>]*>/)?.[0] ?? "";
    assert.match(root, /\sfill="#171F33"/);
  });

  it("opens with every clip on its stable media and the Audio layer in the mix", () => {
    const { media, project } = openSample();
    const ids = new Set(
      OPENING_SAMPLE_MANIFEST.assets.map((asset) => asset.id),
    );
    const mediaClips = project.arrangementClips.filter(
      (clip) =>
        clip.kind !== "fx" && clip.kind !== "text" && clip.kind !== "fill",
    );
    assert.equal(mediaClips.length, (session.selections ?? []).length);
    for (const clip of mediaClips) {
      assert.ok(ids.has(clip.mediaId ?? ""), clip.id);
    }
    // The video clips are silent: no Gain.
    for (const clip of mediaClips.filter(
      (candidate) => candidate.laneId !== AUDIO_LAYER,
    )) {
      assert.equal(
        project.effects.some(
          (effect) =>
            effect.trackId === clipEffectTrackId(clip.id) &&
            effect.effectName === "Gain",
        ),
        false,
        clip.id,
      );
    }
    assert.equal("mainAudioId" in project, false);
    const music = project.sourceSpans.filter(
      (span) => span.mediaId === MUSIC_ID,
    );
    assert.equal(music.length, 1);
    for (const span of music) {
      assert.equal(
        project.sourceTracks.find((track) => track.id === span.sourceTrackId)
          ?.name,
        "Music",
      );
    }
    assert.equal(project.bpm, 80);
    assert.equal(project.overlapNote, "");

    // Once its media is read, only the music has sound.
    const mix = resolveAudioClips({
      clips: project.arrangementClips,
      lanes: project.lanes,
      sourceTracks: project.sourceTracks,
      sourceSpans: project.sourceSpans,
      mediaById: new Map(
        media.map((item) => [item.id, { hasAudio: item.id === MUSIC_ID }]),
      ),
      effects: project.effects,
      bpm: project.bpm,
    });
    assert.equal(mix.fromSourceTracks, false);
    const mixed = [...mix.clips].sort(
      (left, right) => left.startSeconds - right.startSeconds,
    );
    assert.equal(mixed.length, 19);
    let seconds = 0;
    for (const clip of mixed) {
      assert.equal(clip.mediaId, MUSIC_ID);
      assert.equal(clip.busId, AUDIO_LAYER);
      assert.ok(Math.abs(clip.startSeconds - seconds) < 1e-9, clip.id);
      const bar = Math.abs(seconds - 18) < 1e-9 ? 3 : 1.5;
      assert.ok(Math.abs(clip.durationSeconds - bar) < 1e-9, clip.id);
      // Each plays the music where it is in the file, so it runs on
      // unbroken.
      assert.ok(Math.abs(clip.sourceOffsetSeconds) < 1e-9, clip.id);
      assert.equal(clip.hasGain, true, clip.id);
      assert.equal(clip.amplitude, 1, clip.id);
      seconds += clip.durationSeconds;
    }
    assert.ok(Math.abs(seconds - 30) < 1e-9);
  });
});
