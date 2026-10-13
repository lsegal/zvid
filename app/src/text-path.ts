// Lays text along a circle: one line read clockwise, each character placed
// by the angle of its center. Angles are in radians in canvas space (y
// down), where -π/2 is the top of the circle.

import type { TextAlign } from "./text-style.ts";

export type CircleTextInput = {
  text: string;
  fontSize: number;
  minFontSize: number;
  resizeToFit: boolean;
  // Extra space between characters, in ems.
  letterSpacing: number;
  align: TextAlign;
  // The circle's radius, which arc lengths are measured along.
  radius: number;
};

export type CircleGlyph = { text: string; width: number; angle: number };

export type CircleTextLayout = {
  fontSize: number;
  glyphs: CircleGlyph[];
  // Where the text starts and how far round it runs.
  startAngle: number;
  sweep: number;
};

const TOP = -Math.PI / 2;

/**
 * Lines join into one, read clockwise: Left starts at the top, Right ends
 * there and Center straddles it. Justify spreads the characters evenly round
 * the whole circle. Resize to fit shrinks the text until it fits once round.
 */
export function layoutCircleText(
  input: CircleTextInput,
  measure: (text: string, fontSize: number) => number,
): CircleTextLayout {
  const text = input.text.replace(/\s*\n\s*/g, " ").trim();
  const characters = Array.from(text);
  const radius = Math.max(1, input.radius);
  const circumference = 2 * Math.PI * radius;
  const length = (fontSize: number) =>
    measure(text, fontSize) +
    Math.max(0, characters.length - 1) * input.letterSpacing * fontSize;

  let fontSize = input.fontSize;
  const natural = length(fontSize);
  if (input.resizeToFit && natural > circumference) {
    // Widths scale with the font size, so one step lands on the fit.
    fontSize = Math.max(
      input.minFontSize,
      (fontSize * circumference) / natural,
    );
  }

  let spacing = input.letterSpacing * fontSize;
  let total = length(fontSize);
  if (input.align === "justify" && characters.length > 0) {
    // Every gap, including the one that closes the circle, is the same.
    const ink = total - Math.max(0, characters.length - 1) * spacing;
    spacing = Math.max(spacing, (circumference - ink) / characters.length);
    total = ink + (characters.length - 1) * spacing;
  }

  const sweep = total / radius;
  const startAngle =
    input.align === "left"
      ? TOP
      : input.align === "right"
        ? TOP - sweep
        : TOP - sweep / 2;

  const glyphs: CircleGlyph[] = [];
  let prefix = "";
  for (const [index, character] of characters.entries()) {
    // Measuring the run so far keeps the font's kerning.
    const offset = measure(prefix, fontSize) + index * spacing;
    const width = measure(character, fontSize);
    glyphs.push({
      text: character,
      width,
      angle: startAngle + (offset + width / 2) / radius,
    });
    prefix += character;
  }
  return { fontSize, glyphs, startAngle, sweep };
}
