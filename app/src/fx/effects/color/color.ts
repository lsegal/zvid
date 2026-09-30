// The Color effect: which fill clips it paints and the paint its parameters
// describe. Parsing and drawing the paint itself is in fill-paint.ts.
import {
  type FillEffect,
  type FillPaint,
  parseCssColor,
  parseCssGradient,
  type Rgba,
} from "../../../fill-paint.ts";

export const COLOR_EFFECT_NAME = "Color";
export const FILL_MODES = ["Solid", "Gradient"] as const;
export const NEUTRAL_FILL_COLOR = "rgba(128,128,128,1)";
export const DEFAULT_FILL_GRADIENT =
  "linear-gradient(90deg, rgba(124,161,255,1) 0%, rgba(255,111,157,1) 100%)";

export function isColorEffectName(effectName: string) {
  return effectName.trim().toLowerCase() === "color";
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function readParameter(effect: FillEffect, key: string) {
  return effect.parameters.find(
    (parameter) => parameter.key.toLowerCase() === key.toLowerCase(),
  );
}

/**
 * The paint for a fill clip on layer `laneId`: the last enabled Color effect
 * on the clip's own stack (`clipTrackId`), else on that layer's own stack,
 * or a solid neutral grey when there is none.
 */
export function resolveFillPaint(
  effects: readonly FillEffect[],
  laneId: string,
  clipTrackId?: string,
): FillPaint {
  const find = (trackId: string | undefined) =>
    trackId === undefined
      ? undefined
      : effects.findLast(
          (candidate) =>
            candidate.trackId === trackId &&
            candidate.enabled !== false &&
            isColorEffectName(candidate.effectName),
        );
  const effect = find(clipTrackId) ?? find(laneId);
  const fallback: FillPaint = {
    kind: "solid",
    color: parseCssColor(NEUTRAL_FILL_COLOR) as Rgba,
    opacity: 1,
  };
  if (!effect) {
    return fallback;
  }

  const opacityParameter = readParameter(effect, "Opacity");
  const rawOpacity =
    opacityParameter?.numericValue ??
    (opacityParameter ? Number.parseFloat(opacityParameter.value) : 1);
  const opacity = Number.isFinite(rawOpacity) ? clamp(rawOpacity, 0, 1) : 1;
  const mode = readParameter(effect, "Mode")?.value.trim().toLowerCase();
  if (mode === "gradient") {
    const gradient = parseCssGradient(readParameter(effect, "Gradient")?.value);
    if (gradient) {
      return { ...gradient, opacity };
    }
  }

  const color = parseCssColor(readParameter(effect, "Color")?.value);
  return color ? { kind: "solid", color, opacity } : { ...fallback, opacity };
}
