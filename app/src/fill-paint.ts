// The paint a fill clip draws: a solid colour or a linear/radial gradient,
// read from the Color effect on the clip or its layer. Colours and
// gradients are stored as the CSS strings the colour picker produces, such
// as `rgba(255,0,0,1)` or `linear-gradient(90deg, rgba(0,0,0,1) 0%, ...)`,
// so the timeline can show them directly and the compositor parses them
// here.

export type Rgba = { r: number; g: number; b: number; a: number };

export type GradientStop = { offset: number; color: Rgba };

export type FillPaint =
  | { kind: "solid"; color: Rgba; opacity: number }
  | {
      kind: "linear";
      // CSS angle: 0° points up, 90° right, clockwise.
      angleDeg: number;
      stops: GradientStop[];
      opacity: number;
    }
  | { kind: "radial"; stops: GradientStop[]; opacity: number };

export type FillEffect = {
  trackId: string;
  effectName: string;
  parameters: Array<{ key: string; value: string; numericValue?: number }>;
  enabled?: boolean;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function parseChannel(raw: string, scale: number) {
  const value = raw.trim();
  if (value.endsWith("%")) {
    return (Number.parseFloat(value) / 100) * scale;
  }
  return Number.parseFloat(value);
}

/** Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`. */
export function parseCssColor(value: string | undefined): Rgba | undefined {
  const text = value?.trim().toLowerCase();
  if (!text) {
    return undefined;
  }

  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)?.[1];
  if (hex) {
    const digits =
      hex.length <= 4
        ? Array.from(hex, (digit) => digit + digit)
        : (hex.match(/../g) ?? []);
    const [r, g, b, a = "ff"] = digits;
    return {
      r: Number.parseInt(r, 16),
      g: Number.parseInt(g, 16),
      b: Number.parseInt(b, 16),
      a: Number.parseInt(a, 16) / 255,
    };
  }

  const fn = /^rgba?\(([^)]*)\)$/.exec(text)?.[1];
  if (!fn) {
    return undefined;
  }

  const parts = fn.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) {
    return undefined;
  }

  const [r, g, b] = parts.slice(0, 3).map((part) => parseChannel(part, 255));
  const a = parts[3] === undefined ? 1 : parseChannel(parts[3], 1);
  if (![r, g, b, a].every(Number.isFinite)) {
    return undefined;
  }

  return {
    r: clamp(r, 0, 255),
    g: clamp(g, 0, 255),
    b: clamp(b, 0, 255),
    a: clamp(a, 0, 1),
  };
}

export function formatCssColor({ r, g, b, a }: Rgba) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Number(a.toFixed(3))})`;
}

// Splits on commas that are not inside parentheses.
function splitTopLevel(text: string) {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

const SIDE_ANGLES: Record<string, number> = {
  top: 0,
  "top right": 45,
  "right top": 45,
  right: 90,
  "bottom right": 135,
  "right bottom": 135,
  bottom: 180,
  "bottom left": 225,
  "left bottom": 225,
  left: 270,
  "top left": 315,
  "left top": 315,
};

function parseAngle(text: string) {
  const match = /^(-?[\d.]+)(deg|turn|rad)?$/.exec(text.trim());
  if (match) {
    const value = Number.parseFloat(match[1]);
    if (!Number.isFinite(value)) {
      return undefined;
    }
    if (match[2] === "turn") {
      return value * 360;
    }
    if (match[2] === "rad") {
      return (value * 180) / Math.PI;
    }
    return value;
  }

  const side = /^to\s+(.+)$/.exec(text.trim())?.[1]?.replace(/\s+/g, " ");
  return side === undefined ? undefined : SIDE_ANGLES[side];
}

// A stop is a colour optionally followed by a percentage position. Stops
// without one are spread evenly between their neighbours, as in CSS.
function parseStops(parts: string[]) {
  const raw = parts.map((part) => {
    const match = /^(.*?)(?:\s+(-?[\d.]+)%)?$/.exec(part.trim());
    return {
      color: parseCssColor(match?.[1]),
      offset:
        match?.[2] === undefined
          ? undefined
          : clamp(Number.parseFloat(match[2]) / 100, 0, 1),
    };
  });
  if (raw.length < 1 || raw.some((stop) => !stop.color)) {
    return undefined;
  }

  const offsets = raw.map((stop) => stop.offset);
  offsets[0] ??= 0;
  offsets[offsets.length - 1] ??= 1;
  for (let index = 1; index < offsets.length; index += 1) {
    if (offsets[index] !== undefined) {
      continue;
    }
    const nextIndex = offsets.findIndex(
      (offset, candidate) => candidate > index && offset !== undefined,
    );
    const from = offsets[index - 1] ?? 0;
    const to = offsets[nextIndex] ?? 1;
    offsets[index] = from + (to - from) / (nextIndex - index + 1);
  }

  // Positions never go backwards.
  let previous = 0;
  return raw.map<GradientStop>((stop, index) => {
    previous = Math.max(previous, offsets[index] ?? previous);
    return { offset: previous, color: stop.color as Rgba };
  });
}

export type ParsedGradient =
  | { kind: "linear"; angleDeg: number; stops: GradientStop[] }
  | { kind: "radial"; stops: GradientStop[] };

/** Parses a CSS `linear-gradient()` or `radial-gradient()` string. */
export function parseCssGradient(
  value: string | undefined,
): ParsedGradient | undefined {
  const match = /^\s*(linear|radial)-gradient\((.*)\)\s*$/is.exec(value ?? "");
  if (!match) {
    return undefined;
  }

  const kind = match[1].toLowerCase() as "linear" | "radial";
  const parts = splitTopLevel(match[2]);
  let angleDeg = 180;
  if (kind === "linear") {
    const angle = parts[0] ? parseAngle(parts[0]) : undefined;
    if (angle !== undefined) {
      angleDeg = angle;
      parts.shift();
    }
  } else if (parts[0] && !parseStops([parts[0]])) {
    // Shape and size, such as `circle`; the fill always uses a circle that
    // reaches the farthest corner, the CSS default.
    parts.shift();
  }

  const stops = parseStops(parts);
  if (!stops) {
    return undefined;
  }

  return kind === "linear"
    ? { kind, angleDeg: ((angleDeg % 360) + 360) % 360, stops }
    : { kind, stops };
}

function sampleStops(stops: readonly GradientStop[], t: number): Rgba {
  if (t <= stops[0].offset) {
    return stops[0].color;
  }
  for (let index = 1; index < stops.length; index += 1) {
    const to = stops[index];
    if (t <= to.offset) {
      const from = stops[index - 1];
      const span = to.offset - from.offset;
      const mix = span > 0 ? (t - from.offset) / span : 1;
      return {
        r: from.color.r + (to.color.r - from.color.r) * mix,
        g: from.color.g + (to.color.g - from.color.g) * mix,
        b: from.color.b + (to.color.b - from.color.b) * mix,
        a: from.color.a + (to.color.a - from.color.a) * mix,
      };
    }
  }
  return stops[stops.length - 1].color;
}

/**
 * The paint's colour at pixel centre (`x`, `y`) of a `width` × `height`
 * frame, with `y` growing downwards, following CSS gradient geometry.
 */
export function sampleFillPaint(
  paint: FillPaint,
  x: number,
  y: number,
  width: number,
  height: number,
): Rgba {
  let color: Rgba;
  if (paint.kind === "solid") {
    color = paint.color;
  } else {
    const dx = x - width / 2;
    const dy = y - height / 2;
    let t: number;
    if (paint.kind === "linear") {
      const radians = (paint.angleDeg * Math.PI) / 180;
      const sin = Math.sin(radians);
      const cos = Math.cos(radians);
      const length = Math.abs(width * sin) + Math.abs(height * cos);
      t = length > 0 ? (dx * sin - dy * cos) / length + 0.5 : 0;
    } else {
      const radius = Math.hypot(width / 2, height / 2);
      t = radius > 0 ? Math.hypot(dx, dy) / radius : 0;
    }
    color = sampleStops(paint.stops, t);
  }
  return { ...color, a: color.a * paint.opacity };
}

/**
 * RGBA bytes for the paint over a `width` × `height` frame, top row first,
 * ready to upload as a texture.
 */
export function rasterizeFillPaint(
  paint: FillPaint,
  width: number,
  height: number,
) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const pixels = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row += 1) {
    for (let column = 0; column < w; column += 1) {
      const { r, g, b, a } = sampleFillPaint(
        paint,
        column + 0.5,
        row + 0.5,
        w,
        h,
      );
      const offset = (row * w + column) * 4;
      pixels[offset] = Math.round(r);
      pixels[offset + 1] = Math.round(g);
      pixels[offset + 2] = Math.round(b);
      pixels[offset + 3] = Math.round(a * 255);
    }
  }
  return { width: w, height: h, pixels };
}

/** CSS `background` for a fill clip's timeline swatch. */
export function formatFillPaintCss(paint: FillPaint) {
  const withOpacity = (color: Rgba) =>
    formatCssColor({ ...color, a: color.a * paint.opacity });
  if (paint.kind === "solid") {
    return withOpacity(paint.color);
  }

  const stops = paint.stops
    .map(
      (stop) =>
        `${withOpacity(stop.color)} ${Number((stop.offset * 100).toFixed(2))}%`,
    )
    .join(", ");
  return paint.kind === "linear"
    ? `linear-gradient(${Number(paint.angleDeg.toFixed(2))}deg, ${stops})`
    : `radial-gradient(circle, ${stops})`;
}

// The Color effect's own parameters, kept here so existing imports still
// resolve.
export * from "./fx/effects/color/color.ts";
