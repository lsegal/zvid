import { normalizeEffectAnimation } from "../../fx-animation-defaults.ts";
import type { LvpSession } from "../../session.ts";
import type { SessionEffect } from "./types.ts";

export function mapEffects(source: LvpSession["effects"]) {
  return (source ?? []).map<SessionEffect>((effect) => {
    const animation = normalizeEffectAnimation(
      effect.animation,
      effect.effectName,
    );
    return {
      id: effect.id,
      trackId: effect.trackId,
      effectName: effect.effectName,
      parameters: Object.entries(effect.parameters ?? {}).map(
        ([key, value]) => ({
          key,
          value:
            typeof value.stringValue === "string"
              ? value.stringValue
              : formatStoredNumber(value.floatValue ?? 0),
          numericValue: value.floatValue,
        }),
      ),
      // Sessions without the flag, including every Layers session, are on.
      enabled: effect.enabled !== false,
      ...(animation ? { animation } : {}),
      ...(effect.defaulted === true ? { defaulted: true } : {}),
    };
  });
}

export function formatStoredNumber(value: number) {
  return value.toFixed(3);
}
