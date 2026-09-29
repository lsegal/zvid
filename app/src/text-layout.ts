// Lays text out in a box: wraps it at the box width, aligns it, and for
// Resize to fit finds the largest size up to the chosen one at which the
// wrapped text fits. Measuring goes through `TextMeasure`, so this is pure
// and runs the same over Canvas 2D in the compositor and a stub in tests.

import type { TextAlign, TextVerticalAlign } from "./text-style.ts";

/** Width of `text` at `fontSize` pixels, without letter spacing. */
export type TextMeasure = (text: string, fontSize: number) => number;

export type TextLayoutOptions = {
  text: string;
  // With `resizeToFit`, the largest size tried.
  fontSize: number;
  // The smallest size Resize to fit shrinks to before clipping.
  minFontSize: number;
  resizeToFit: boolean;
  // Multiple of the font size.
  lineHeight: number;
  // Ems between characters.
  letterSpacing: number;
  align: TextAlign;
  verticalAlign: TextVerticalAlign;
  width: number;
  height: number;
  padding: number;
};

export type TextLine = {
  text: string;
  // Left edge and top of the line box.
  x: number;
  y: number;
  width: number;
  // Word positions for a justified line, which spreads its words out.
  words?: Array<{ text: string; x: number }>;
};

export type TextLayout = {
  fontSize: number;
  // Line box height in pixels.
  lineHeight: number;
  lines: TextLine[];
  // False when the text overflows the box and is clipped.
  fits: boolean;
};

type WrappedLine = { text: string; width: number; paragraphEnd: boolean };

// Resize to fit narrows the size down to this many pixels.
const SIZE_PRECISION = 0.25;
// Measurements this close to the limit still count as fitting.
const FIT_TOLERANCE = 0.5;

function characterCount(text: string) {
  return Array.from(text).length;
}

function createWidth(
  measure: TextMeasure,
  fontSize: number,
  letterSpacing: number,
) {
  const spacing = letterSpacing * fontSize;
  return (text: string) =>
    text ? measure(text, fontSize) + spacing * (characterCount(text) - 1) : 0;
}

// Splits a word too wide for a line into pieces that fit, a character at a
// time. Every piece holds at least one character.
function breakWord(
  word: string,
  maxWidth: number,
  width: (t: string) => number,
) {
  const pieces: string[] = [];
  let current = "";
  for (const character of word) {
    const candidate = current + character;
    if (current && width(candidate) > maxWidth + FIT_TOLERANCE) {
      pieces.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) {
    pieces.push(current);
  }
  return pieces;
}

/** Wraps each paragraph at `maxWidth`, breaking words wider than a line. */
export function wrapText(
  text: string,
  maxWidth: number,
  width: (text: string) => number,
): WrappedLine[] {
  const lines: WrappedLine[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    const paragraphLines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (width(candidate) <= maxWidth + FIT_TOLERANCE) {
        current = candidate;
        continue;
      }
      if (current) {
        paragraphLines.push(current);
      }
      const pieces =
        width(word) <= maxWidth + FIT_TOLERANCE
          ? [word]
          : breakWord(word, maxWidth, width);
      current = pieces.pop() ?? "";
      paragraphLines.push(...pieces);
    }
    paragraphLines.push(current);
    paragraphLines.forEach((line, index) => {
      lines.push({
        text: line,
        width: width(line),
        paragraphEnd: index === paragraphLines.length - 1,
      });
    });
  }
  return lines;
}

function wrapAt(
  options: TextLayoutOptions,
  measure: TextMeasure,
  fontSize: number,
) {
  const innerWidth = Math.max(0, options.width - options.padding * 2);
  const innerHeight = Math.max(0, options.height - options.padding * 2);
  const width = createWidth(measure, fontSize, options.letterSpacing);
  const lines = wrapText(options.text, innerWidth, width);
  const fits =
    lines.every((line) => line.width <= innerWidth + FIT_TOLERANCE) &&
    lines.length * fontSize * options.lineHeight <= innerHeight + FIT_TOLERANCE;
  return { lines, fits, width };
}

// The largest size in [minimum, maximum] at which the text fits, or the
// minimum when it doesn't fit even there.
function findFittingSize(options: TextLayoutOptions, measure: TextMeasure) {
  const maximum = Math.max(options.minFontSize, options.fontSize);
  if (wrapAt(options, measure, maximum).fits) {
    return maximum;
  }
  let low = options.minFontSize;
  let high = maximum;
  if (!wrapAt(options, measure, low).fits) {
    return low;
  }
  while (high - low > SIZE_PRECISION) {
    const middle = (low + high) / 2;
    if (wrapAt(options, measure, middle).fits) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return low;
}

/** Lays the text out in its box, shrinking it first with Resize to fit. */
export function layoutText(
  options: TextLayoutOptions,
  measure: TextMeasure,
): TextLayout {
  const fontSize = options.resizeToFit
    ? findFittingSize(options, measure)
    : Math.max(options.minFontSize, options.fontSize);
  const { lines, fits, width } = wrapAt(options, measure, fontSize);
  const lineHeight = fontSize * options.lineHeight;
  const inner = {
    x: options.padding,
    y: options.padding,
    width: Math.max(0, options.width - options.padding * 2),
    height: Math.max(0, options.height - options.padding * 2),
  };
  const textHeight = lines.length * lineHeight;
  const top =
    options.verticalAlign === "top"
      ? inner.y
      : options.verticalAlign === "bottom"
        ? inner.y + inner.height - textHeight
        : inner.y + (inner.height - textHeight) / 2;

  return {
    fontSize,
    lineHeight,
    fits,
    lines: lines.map<TextLine>((line, index) => {
      const y = top + index * lineHeight;
      const free = inner.width - line.width;
      if (options.align === "justify") {
        const words = line.text.split(" ");
        // The last line of a paragraph stays left aligned, as in print.
        if (line.paragraphEnd || words.length < 2) {
          return { text: line.text, x: inner.x, y, width: line.width };
        }
        const wordWidths = words.map(width);
        const gap =
          (inner.width - wordWidths.reduce((sum, value) => sum + value, 0)) /
          (words.length - 1);
        let x = inner.x;
        return {
          text: line.text,
          x: inner.x,
          y,
          width: inner.width,
          words: words.map((word, wordIndex) => {
            const position = { text: word, x };
            x += wordWidths[wordIndex] + gap;
            return position;
          }),
        };
      }
      const x =
        options.align === "left"
          ? inner.x
          : options.align === "right"
            ? inner.x + free
            : inner.x + free / 2;
      return { text: line.text, x, y, width: line.width };
    }),
  };
}
