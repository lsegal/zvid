# Effects

Every effect that a `.lvp` session can reference by `effectName` has its own folder under `effects/`:

```text
effects/<effect>/
  definition.ts   its FxEffectDefinition and menuOrder (required)
  pass.ts         its WebGL shader pass, if it draws with a shader
  *.ts            parsing specific to the effect, e.g. order/order.ts
  *.test.ts       its tests
```

Shared code sits next to `effects/`:

- `types.ts`: the definition types (`FxEffectDefinition`, `FxParameterDefinition`, `FxEffectScope`, …).
- `params.ts`: parameter builders (`unitParameter`, `zoomParameter`, `transformParameter`, `moveParameters`) and display formatters (`formatPercent`, `formatPixels`, …).
- `pass-test-utils.ts`: helpers for testing a shader pass without WebGL.

`stack/` holds the FX stack model and its operations, which work on any effect.

## The generated index

`scripts/gen-fx-index.mjs` scans `effects/*/definition.ts` and `effects/*/pass.ts` and writes `effects/index.generated.ts`, which imports each one in folder order. `src/fx-registry.ts` builds `FX_EFFECT_DEFINITIONS` from it, sorted by each definition's `menuOrder`, and `src/fx-shaders/registry.ts` builds its shader pass lookup from it. The rest of the app keeps importing from those two files.

The index is committed, so a fresh checkout type-checks without running anything. `dev`, `build`, `lint` and `test:unit` regenerate it first, and CI runs `node app/scripts/gen-fx-index.mjs --check`, which fails when the committed index doesn't match the effect folders. Biome skips `*.generated.ts`.

## Adding an effect

1. Create `effects/<effect>/definition.ts`, with a kebab-case folder name. It must export:
   - `definition`: the `FxEffectDefinition`, whose `effectName` matches the name `.lvp` sessions use;
   - `menuOrder`: a number that places the effect in the add menus, lowest first. The built-in effects use multiples of 10, so a new one can go between any two.
2. If the effect draws with a shader, create `effects/<effect>/pass.ts` exporting `pass`, an `EffectPass` whose `effectName` matches the definition's.
3. Put the effect's parsing and its tests in the same folder.
4. Run `pnpm --dir app run gen:fx-index`, or any of `dev`, `build`, `lint` or `test:unit`, and commit the updated `effects/index.generated.ts`.

You don't need to edit any shared registry file.
