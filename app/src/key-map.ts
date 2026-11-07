// The Key Map: computer keys mapped to buttons in effect devices. A mapping
// names a button by its effect's id and what the button does, not by anything
// on screen, so it works while its device isn't shown, is saved in the session
// and goes away with its device. One key can drive several buttons; each
// button has one key.
import {
  effectHistoryLabels,
  mapSessionEffectsToDevices,
  type SessionEffect,
  setEffectAnimationEnabled,
  setEffectEnabled,
  setEffectModulationEnabled,
  setEffectParameter,
} from "./fx-stack.ts";
import { toggleStyleFlag } from "./text-style.ts";

export type KeyMapTarget =
  | { kind: "power"; effectId: string }
  // The device's Animation or Modulation switch.
  | { kind: "modifier"; effectId: string }
  | { kind: "toggle"; effectId: string; parameter: string }
  | { kind: "flag"; effectId: string; parameter: string; value: string }
  | { kind: "option"; effectId: string; parameter: string; value: string }
  | { kind: "pad"; effectId: string; parameter: string; pad: number };

export type KeyMapping = { key: string; target: KeyMapTarget };

export type KeyMapKeyEvent = Pick<
  KeyboardEvent,
  "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
>;

// Space and Escape keep their jobs, and so do Tab, which moves focus, and
// Delete and Backspace, which remove a mapping while mapping. The rest are
// modifiers and keys that are still composing a character.
const UNMAPPABLE_KEYS = new Set([
  " ",
  "Escape",
  "Tab",
  "Delete",
  "Backspace",
  "Shift",
  "Control",
  "Alt",
  "AltGraph",
  "Meta",
  "OS",
  "Fn",
  "FnLock",
  "Hyper",
  "Super",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "ContextMenu",
  "Compose",
  "Dead",
  "Process",
  "Unidentified",
]);

const KEY_LABELS: Readonly<Record<string, string>> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "↵",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Insert: "Ins",
};

/**
 * The key `event` presses as a mapping names it, or undefined when it can't
 * be mapped. Ctrl, Cmd and Alt combinations belong to the app and the system.
 * Shift only picks the character, so Shift+Q is Q, and leaves named keys such
 * as Shift+ArrowLeft to the shortcuts that use them.
 */
export function mappableKey(event: KeyMapKeyEvent) {
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    UNMAPPABLE_KEYS.has(event.key)
  ) {
    return undefined;
  }
  if (event.key.length === 1) {
    return event.key.toLowerCase();
  }
  return event.shiftKey ? undefined : event.key;
}

/** How a button shows its key while mapping. */
export function keyLabel(key: string) {
  return KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

/** One button's identity, for comparing targets. */
export function keyMapTargetId(target: { kind: string; effectId: string }) {
  return JSON.stringify(Object.values(target));
}

export function findKeyMapping(
  mappings: readonly KeyMapping[] | undefined,
  target: KeyMapTarget,
) {
  const id = keyMapTargetId(target);
  return mappings?.find((mapping) => keyMapTargetId(mapping.target) === id);
}

/** Maps `key` to `target`, in place of any key it had. */
export function assignKeyMapping(
  mappings: readonly KeyMapping[] | undefined,
  target: KeyMapTarget,
  key: string,
) {
  const existing = findKeyMapping(mappings, target);
  return existing?.key === key
    ? mappings
    : [
        ...(removeKeyMapping(mappings, target) ?? []),
        { key, target } satisfies KeyMapping,
      ];
}

/** `mappings` without `target`'s; undefined once none are left. */
export function removeKeyMapping(
  mappings: readonly KeyMapping[] | undefined,
  target: KeyMapTarget,
) {
  const existing = findKeyMapping(mappings, target);
  if (!existing) {
    return mappings;
  }
  const rest = mappings?.filter((mapping) => mapping !== existing);
  return rest?.length ? rest : undefined;
}

/**
 * `mappings` without those of effects that are gone: the same array when none
 * are, and undefined once none are left.
 */
export function pruneKeyMappings(
  mappings: readonly KeyMapping[] | undefined,
  effects: readonly SessionEffect[],
) {
  const ids = new Set(effects.map((effect) => effect.id));
  const kept = mappings?.filter((mapping) => ids.has(mapping.target.effectId));
  if (kept?.length === mappings?.length) {
    return mappings;
  }
  return kept?.length ? kept : undefined;
}

export function readKeyMapTarget(raw: unknown): KeyMapTarget | undefined {
  const target = raw as Partial<Record<string, unknown>> | null;
  const { kind, effectId, parameter, value, pad } = target ?? {};
  if (typeof effectId !== "string") {
    return undefined;
  }
  if (kind === "power" || kind === "modifier") {
    return { kind, effectId };
  }
  if (typeof parameter !== "string") {
    return undefined;
  }
  if (kind === "toggle") {
    return { kind, effectId, parameter };
  }
  if ((kind === "flag" || kind === "option") && typeof value === "string") {
    return { kind, effectId, parameter, value };
  }
  return kind === "pad" && typeof pad === "number" && Number.isInteger(pad)
    ? { kind, effectId, parameter, pad }
    : undefined;
}

/**
 * The usable mappings of an opened session: those of effects it has, with
 * keys that can be mapped, one per button. Undefined when it has none, as a
 * session from before the Key Map does.
 */
export function readKeyMappings(
  raw: unknown,
  effects: readonly SessionEffect[],
): readonly KeyMapping[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  let mappings: readonly KeyMapping[] | undefined;
  for (const entry of raw) {
    const target = readKeyMapTarget(entry?.target);
    const key = entry?.key;
    if (
      target &&
      typeof key === "string" &&
      mappableKey({
        key,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }) === key
    ) {
      mappings = assignKeyMapping(mappings, target, key);
    }
  }
  return pruneKeyMappings(mappings, effects);
}

export type KeyMapPress =
  // An edit, which is labeled and undoes just as clicking the button is.
  | { kind: "edit"; label: string; effects: SessionEffect[] }
  // A Drum Rack pad, which plays from the rack's settings and edits nothing.
  | { kind: "pad"; pad: number; settings: string };

/**
 * What pressing `target`'s button does to `effects`, read from the device as
 * the button reads it. Undefined when the button is gone, such as a parameter
 * its device no longer has or doesn't offer in its current state.
 */
export function pressKeyMapTarget(
  effects: SessionEffect[],
  target: KeyMapTarget,
): KeyMapPress | undefined {
  const { effectId } = target;
  const effect = effects.find((candidate) => candidate.id === effectId);
  if (!effect) {
    return undefined;
  }
  const [device] = mapSessionEffectsToDevices([effect], effect.trackId);
  const name = device.effectName;
  const edit = (label: string, next: SessionEffect[]): KeyMapPress => ({
    kind: "edit",
    label,
    effects: next,
  });

  if (target.kind === "power") {
    const enabled = !device.enabled;
    return edit(
      effectHistoryLabels.enabled(name, enabled),
      setEffectEnabled(effects, effectId, enabled),
    );
  }
  if (target.kind === "modifier") {
    if (device.supportsAnimation) {
      const enabled = device.animation?.enabled !== true;
      return edit(
        effectHistoryLabels.animationEnabled(name, enabled),
        setEffectAnimationEnabled(effects, effectId, enabled),
      );
    }
    if (device.supportsModulation) {
      const enabled = device.modulation?.enabled !== true;
      return edit(
        effectHistoryLabels.modulationEnabled(name, enabled),
        setEffectModulationEnabled(effects, effectId, enabled),
      );
    }
    return undefined;
  }

  const parameter = device.parameters.find(
    (candidate) => candidate.key === target.parameter,
  );
  if (!parameter) {
    return undefined;
  }
  const set = (value: number | string) =>
    edit(
      effectHistoryLabels.parameter(name, parameter.key),
      setEffectParameter(effects, effectId, parameter.key, value),
    );
  if (target.kind === "toggle") {
    return set((parameter.numericValue ?? 0) >= 0.5 ? 0 : 1);
  }
  if (target.kind === "flag") {
    return parameter.flags?.some((flag) => flag.value === target.value)
      ? set(toggleStyleFlag(parameter.stringValue ?? "", target.value))
      : undefined;
  }
  if (target.kind === "option") {
    return parameter.options?.includes(target.value)
      ? set(target.value)
      : undefined;
  }
  return {
    kind: "pad",
    pad: target.pad,
    settings: parameter.stringValue ?? "",
  };
}
