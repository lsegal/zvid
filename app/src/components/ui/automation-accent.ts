// The color a knob or fader shows where Animation or Modulation has moved
// it to, set apart from the device's own `accent`: the accent's opposite
// hue, or mint for an accent with too little color to have one.

const FALLBACK = "#7ee0a4";

function parseHex(color: string) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) {
    return undefined;
  }
  const digits =
    match[1].length === 3
      ? [...match[1]].map((digit) => digit + digit).join("")
      : match[1];
  return [0, 2, 4].map(
    (start) => Number.parseInt(digits.slice(start, start + 2), 16) / 255,
  );
}

function toHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// `hue` in degrees, `saturation` and `lightness` 0..1, as hex.
function hslToHex(hue: number, saturation: number, lightness: number) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    return lightness - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return toHex(channel(0), channel(8), channel(4));
}

export function automationAccent(accent: string) {
  const rgb = parseHex(accent);
  if (!rgb) {
    return FALLBACK;
  }
  const [red, green, blue] = rgb;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.25 || delta < 0.15) {
    return FALLBACK;
  }
  const hue =
    max === red
      ? 60 * (((green - blue) / delta + 6) % 6)
      : max === green
        ? 60 * ((blue - red) / delta + 2)
        : 60 * ((red - green) / delta + 4);
  return hslToHex((hue + 180) % 360, 0.8, 0.68);
}
