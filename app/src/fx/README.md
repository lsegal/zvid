# Effects

Every effect that a session can reference by `effectName` has its own folder under `effects/`:

```text
effects/<effect>/
  definition.ts   its FxEffectDefinition and menuOrder (required)
  pass.ts         its WebGL shader pass, if it draws with a shader
  processor.ts    its audio processor, if it is an audio effect
  *.ts            parsing specific to the effect, e.g. order/order.ts
  *.test.ts       its tests
```

Shared code sits next to `effects/`:

- `types.ts`: the definition types (`FxEffectDefinition`, `FxParameterDefinition`, `FxEffectScope`, …).
- `params.ts`: parameter builders (`unitParameter`, `zoomParameter`, `transformParameter`, `moveParameters`) and display formatters (`formatPercent`, `formatPixels`, …).
- `pass-test-utils.ts`: helpers for testing a shader pass without WebGL.
- `taper.ts`: how a knob's travel maps to a number parameter's range, linear or `taper: "log"`.

`stack/` holds the FX stack model and its operations, which work on any effect.

## The generated index

`scripts/gen-fx-index.mjs` scans `effects/*/definition.ts` and `effects/*/pass.ts` and writes `effects/index.generated.ts`, which imports each one in folder order. It also scans `effects/*/processor.ts` and writes `effects/processors.generated.ts`, which the audio chain reads (`src/audio-mix/processors.ts`); the processors get their own index so the chain worklet bundles them without the definitions and shader passes. `src/fx-registry.ts` builds `FX_EFFECT_DEFINITIONS` from it, sorted by each definition's `menuOrder`, and `src/fx-shaders/registry.ts` builds its shader pass lookup from it. The rest of the app keeps importing from those two files.

The index is committed, so a fresh checkout type-checks without running anything. `dev`, `build`, `lint` and `test:unit` regenerate it first, and CI runs `node app/scripts/gen-fx-index.mjs --check`, which fails when the committed index doesn't match the effect folders. Biome skips `*.generated.ts`.

## Adding an effect

1. Create `effects/<effect>/definition.ts`, with a kebab-case folder name. It must export:
   - `definition`: the `FxEffectDefinition`, whose `effectName` matches the name sessions use;
   - `menuOrder`: a number that places the effect in the add menus, lowest first. The built-in effects use multiples of 10, so a new one can go between any two.
2. If the effect draws with a shader, create `effects/<effect>/pass.ts` exporting `pass`, an `EffectPass` whose `effectName` matches the definition's.
   A pass that needs an intermediate picture, such as a blur to build a glow from, can declare `stages`: shaders the chain draws first, each at `stageScale` of the picture's size, which the stages after them and the main shader read through samplers named after them. Bloom (`effects/bloom/pass.ts`) blurs at a fraction of the frame this way.
   A distance in output pixels at 1080p, like Gaussian Blur's Radius, should be multiplied by `effectPixelScale(ctx)` (`src/fx-shaders/types.ts`), which converts it into pixels of the picture the pass or stage draws, so it looks the same on a layer, on Global, in the preview and in export at any output size.
   A device control that shows the picture reaching its effect, such as the histogram behind Levels' curve, watches it with `watchFrameHistogram` (`src/fx-shaders/frame-analysis.ts`). The preview's chain then reads a small copy of that picture back at most every 100 ms while the control is shown; export never does.
   If it is an audio effect (`domain: "audio"`), create `effects/<effect>/processor.ts` exporting `processor`, an `AudioEffectDsp` (`src/audio-mix/processor.ts`) whose `effectName` matches the definition's. See [Audio processors](#audio-processors).
3. Put the effect's parsing and its tests in the same folder.
4. Run `pnpm --dir app run gen:fx-index`, or any of `dev`, `build`, `lint` or `test:unit`, and commit the updated `effects/index.generated.ts`.

You don't need to edit any shared registry file.

## Per-type registries

An effect whose types are one file each lists the folder in `TYPE_REGISTRIES` in `scripts/gen-fx-index.mjs`, which writes the folder's `index.generated.ts` with every `*.ts` file in it but tests. The Transition effect's types (`effects/transition/types/`) work this way: each file exports `transitionType`, a `TransitionTypeDefinition` (`effects/transition/type.ts`) with its name, menu order, the options it uses (Direction, Softness), a GLSL snippet and the same function in TypeScript for tests. A new type adds its file, runs `pnpm --dir app run gen:fx-index`, and edits nothing else.

## Audio processors

An audio effect's `processor` is plain TypeScript, written once: the preview runs it in the chain worklet (`src/audio-mix/chain-worklet.ts`) and export runs it in the offline render (`src/audio-mix/mix.ts`), both through `AudioChain` (`src/audio-mix/chain.ts`), so the two hear the same DSP. It must not touch the DOM or any main-thread API.

- `createProcessor(sampleRate, channels)` returns an object whose `process(input, output, frames, params, time)` handles one block, holding its state between blocks. The chain makes a fresh one to reset it: after a seek, when a stage turns on, or once it has been idle.
- `params.number(key)` gives a number parameter's value at every frame of the block, ramped over 15 ms after an edit; `params.value(key)` and `params.changing(key)` let a processor skip per-frame work while it holds steady. Enum and toggle parameters are switches, read with `params.switch(key)`; the chain crossfades a switch change between a processor at the old value and a fresh one at the new.
- `time` gives the timeline second of the block's first frame and the session's BPM and time signature. Use `noteValueSeconds` and `timelinePhase` (`src/audio-mix/tempo.ts`) for synced delays and LFOs, so they line up the same in preview, scrubbing and export.
- `tailSeconds(settings, tempo)` is how long it keeps sounding once its input falls silent (a reverb's decay, a delay's feedback); its chain keeps running that long past a clip's end, and export pre-rolls that far before its range.
- `latencyFrames(settings, sampleRate)` is how late its output is (a limiter's lookahead); the mix delays the other paths to match and keeps the whole mix aligned with the video.
- `source` changes what a clip reads from its media instead (Reverse): its `readSeconds` maps each timeline second to the one whose media plays. The preview then plays the clip from a decoded buffer.

Where an effect sits sets what it processes: on a clip's stack, that clip alone; on a layer's or source track's stack, the sum of its clips (its bus); on Global, the whole mix, before the limiter. A clip with no enabled Gain on its track's stack or its own stays silent. A mix of Gains alone plays through native gain nodes in the preview, which reproduce export exactly; any other enabled audio effect switches the preview to the worklet.

Number parameters for frequencies and times should set `taper: "log"`, so knob travel and steps move by ratio.
