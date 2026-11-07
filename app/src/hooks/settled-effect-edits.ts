import type { SessionEffect } from "../fx-stack.ts";

// How long a control rests before its moves become one undo step.
const SETTLE_MS = 400;

export type SettledEditEffects = (
  label: string,
  updater: (effects: SessionEffect[]) => SessionEffect[],
  mode?: "commit" | "transient",
) => void;

/**
 * Edits from a MIDI control's moves: each shows at once, and a run of them
 * becomes one undo step once the control rests, or on `flush`.
 */
export function settledEffectEdits(editEffects: SettledEditEffects) {
  let settling: ReturnType<typeof setTimeout> | undefined;
  let settle: (() => void) | undefined;
  return {
    edit(
      label: string,
      updater: (effects: SessionEffect[]) => SessionEffect[],
    ) {
      editEffects(label, updater, "transient");
      clearTimeout(settling);
      settle = () => {
        settle = undefined;
        editEffects(label, (effects) => effects);
      };
      settling = setTimeout(settle, SETTLE_MS);
    },
    flush() {
      clearTimeout(settling);
      settle?.();
    },
  };
}
