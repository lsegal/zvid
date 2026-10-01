// A layer's effect stack is the ordered subset of the project's `effects`
// array that shares one `trackId` (a Layer id, a clip's `clip:<clipId>` or
// GLOBAL_EFFECT_TRACK_ID). Array order is stack order. The helpers are pure: each returns a new
// `effects` array, or the same array when nothing changed so history
// commits can skip no-op edits.
//
// The stack lives in `fx/stack/`, one module per concern; this module
// re-exports it so callers keep one import path.

export {
  clipEffectTrackId,
  copyClipEffects,
  GLOBAL_EFFECT_TRACK_ID,
  getEffectClipId,
  getTrackGroup,
  previewDuplicateClipEffects,
  pruneClipEffects,
  renameClipEffectTracks,
} from "./fx/stack/clip-stacks.ts";
export {
  mapSessionEffectsToDevices,
  ORDER_RUNS_FIRST_NOTE,
} from "./fx/stack/devices.ts";
export {
  type FxClip,
  type FxLayer,
  getRenderedEffects,
  isContentEffectName,
  isLayerFxEnabled,
  isLayoutEffectName,
  LAYOUT_EFFECT_NAME,
  setLaneFxEnabled,
} from "./fx/stack/layer-fx.ts";
export {
  addEffect,
  createEffect,
  duplicateEffect,
  effectHistoryLabels,
  ensureGlobalOrder,
  ensureLayerLayouts,
  getEffectDisplayName,
  hasGlobalOrder,
  moveEffect,
  pruneExcludedLayers,
  removeEffect,
  resetEffect,
  setEffectAnimation,
  setEffectAnimationEnabled,
  setEffectEnabled,
  setEffectParameter,
} from "./fx/stack/ops.ts";
export { mapEffects } from "./fx/stack/session-mapping.ts";
export type {
  EffectParameter,
  FxDevice,
  FxDeviceGroup,
  FxDeviceParameter,
  SessionEffect,
} from "./fx/stack/types.ts";
