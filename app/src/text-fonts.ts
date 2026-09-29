// The fonts a Text effect can use and their loading state. A font is stored
// as its family name for fonts bundled with the app, or with a `google:` or
// `local:` prefix for Google Fonts loaded on demand and fonts installed on
// this machine, so every client knows where to load it from.
//
// The compositor draws text with Canvas 2D, which silently substitutes a
// fallback for a face that hasn't loaded yet. Faces are loaded here first,
// and a family that can't be loaded is reported missing so it is drawn in
// the default font and flagged on its device.

import { invoke, isTauri } from "@tauri-apps/api/core";

export type FontSource = "bundled" | "google" | "local";

export type FontChoice = { source: FontSource; family: string };

export type BundledFont = {
  family: string;
  // The family name its `@font-face` rules register (see text-fonts.css).
  cssFamily: string;
  weights: readonly number[];
};

export const FONT_WEIGHTS = [
  { label: "Thin", value: 100 },
  { label: "Extra Light", value: 200 },
  { label: "Light", value: 300 },
  { label: "Regular", value: 400 },
  { label: "Medium", value: 500 },
  { label: "Semibold", value: 600 },
  { label: "Bold", value: 700 },
  { label: "Extra Bold", value: 800 },
  { label: "Black", value: 900 },
] as const;

export const FONT_WEIGHT_LABELS: readonly string[] = FONT_WEIGHTS.map(
  (weight) => weight.label,
);

const ALL_WEIGHTS = FONT_WEIGHTS.map((weight) => weight.value);

export const BUNDLED_FONTS: readonly BundledFont[] = [
  { family: "Inter", cssFamily: "Inter Variable", weights: ALL_WEIGHTS },
  {
    family: "Montserrat",
    cssFamily: "Montserrat Variable",
    weights: ALL_WEIGHTS,
  },
  {
    family: "Playfair Display",
    cssFamily: "Playfair Display Variable",
    weights: [400, 500, 600, 700, 800, 900],
  },
  { family: "Bebas Neue", cssFamily: "Bebas Neue", weights: [400] },
  { family: "Anton", cssFamily: "Anton", weights: [400] },
  {
    family: "Space Grotesk",
    cssFamily: "Space Grotesk",
    weights: [400, 500, 700],
  },
  {
    family: "IBM Plex Mono",
    cssFamily: "IBM Plex Mono",
    weights: [400, 500, 600],
  },
];

export const DEFAULT_FONT_FAMILY = "Inter";

// Popular Google Fonts families offered in the font list. Any other family
// name can be typed into the search.
export const GOOGLE_FONTS: readonly string[] = [
  "Roboto",
  "Open Sans",
  "Lato",
  "Poppins",
  "Oswald",
  "Raleway",
  "Nunito",
  "Rubik",
  "Work Sans",
  "Fira Sans",
  "Barlow Condensed",
  "Roboto Slab",
  "Roboto Mono",
  "Merriweather",
  "DM Serif Display",
  "Abril Fatface",
  "Archivo Black",
  "Alfa Slab One",
  "Righteous",
  "Bangers",
  "Lobster",
  "Pacifico",
  "Dancing Script",
  "Caveat",
  "Permanent Marker",
  "Shrikhand",
  "Monoton",
  "Press Start 2P",
];

const GENERIC_FALLBACK = "sans-serif";

export function parseFontChoice(value: string | undefined): FontChoice {
  const text = value?.trim() ?? "";
  const match = /^(google|local):\s*(.+)$/i.exec(text);
  if (match) {
    return {
      source: match[1].toLowerCase() as FontSource,
      family: match[2].trim(),
    };
  }
  return { source: "bundled", family: text || DEFAULT_FONT_FAMILY };
}

export function formatFontChoice({ source, family }: FontChoice) {
  return source === "bundled" ? family : `${source}:${family}`;
}

export function findBundledFont(family: string) {
  const name = family.trim().toLowerCase();
  return BUNDLED_FONTS.find((font) => font.family.toLowerCase() === name);
}

/** The weights the font has; every weight for fonts not bundled. */
export function getFontWeights(choice: FontChoice): readonly number[] {
  return (
    (choice.source === "bundled" && findBundledFont(choice.family)?.weights) ||
    ALL_WEIGHTS
  );
}

export function getFontWeightLabels(value: string | undefined) {
  const weights = new Set(getFontWeights(parseFontChoice(value)));
  return FONT_WEIGHTS.filter((weight) => weights.has(weight.value)).map(
    (weight) => weight.label,
  );
}

export function parseFontWeight(label: string | undefined) {
  const text = label?.trim().toLowerCase() ?? "";
  const named = FONT_WEIGHTS.find(
    (weight) => weight.label.toLowerCase() === text,
  );
  if (named) {
    return named.value;
  }
  const numeric = Number.parseFloat(text);
  return Number.isFinite(numeric) ? Math.max(1, Math.min(1000, numeric)) : 400;
}

/** The available weight closest to `weight`, preferring the heavier on a tie. */
export function nearestFontWeight(
  weight: number,
  available: readonly number[],
) {
  let best = available[0] ?? weight;
  for (const candidate of available) {
    const distance = Math.abs(candidate - weight);
    const bestDistance = Math.abs(best - weight);
    if (
      distance < bestDistance ||
      (distance === bestDistance && candidate > best)
    ) {
      best = candidate;
    }
  }
  return best;
}

export type FontFace = {
  // The stored font value, such as `google:Roboto`.
  value: string;
  cssFamily: string;
  weight: number;
  italic: boolean;
};

function quoteFamily(family: string) {
  return `"${family.replace(/["\\]/g, "")}"`;
}

/** A CSS `font-family` list for the face, with the generic fallback. */
export function formatFontFamily(face: FontFace) {
  return `${quoteFamily(face.cssFamily)}, ${GENERIC_FALLBACK}`;
}

/** A CSS `font` shorthand for the face at `sizePx`. */
export function formatFontSpec(face: FontFace, sizePx: number) {
  return `${face.italic ? "italic " : ""}${face.weight} ${sizePx}px ${formatFontFamily(face)}`;
}

/**
 * The face the compositor draws: the chosen font at its nearest available
 * weight, or the default font when `missing` holds the chosen font.
 */
export function resolveFontFace(
  value: string,
  weight: number,
  italic: boolean,
  missing: ReadonlySet<string> = getMissingFonts(),
): FontFace {
  const choice = parseFontChoice(value);
  const usable = missing.has(formatFontChoice(choice))
    ? parseFontChoice(DEFAULT_FONT_FAMILY)
    : choice;
  return {
    value: formatFontChoice(usable),
    cssFamily:
      usable.source === "bundled"
        ? (findBundledFont(usable.family)?.cssFamily ?? usable.family)
        : usable.family,
    weight: nearestFontWeight(weight, getFontWeights(usable)),
    italic,
  };
}

// Loading state, shared by every renderer and the FX panel.

type FaceStatus = "loading" | "ready";

const faceStatuses = new Map<string, FaceStatus>();
const googleStylesheets = new Map<string, Promise<boolean>>();
let missingFonts: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function faceKey(face: FontFace) {
  return `${face.value}|${face.weight}|${face.italic ? "italic" : "normal"}`;
}

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

/** Calls `listener` whenever a face finishes loading or a font goes missing. */
export function subscribeFonts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Fonts that could not be loaded, as stored font values. */
export function getMissingFonts() {
  return missingFonts;
}

function markMissing(value: string) {
  if (!missingFonts.has(value)) {
    missingFonts = new Set([...missingFonts, value]);
  }
}

function getFontSet(): FontFaceSet | undefined {
  return typeof document === "undefined" ? undefined : document.fonts;
}

export function googleFontsCssUrl(
  families: readonly string[],
  face?: FontFace,
) {
  const params = families
    .map((family) => {
      const name = encodeURIComponent(family).replace(/%20/g, "+");
      return face
        ? `family=${name}:ital,wght@${face.italic ? 1 : 0},${face.weight}`
        : `family=${name}`;
    })
    .join("&");
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

// Adds a Google Fonts stylesheet once per URL. Resolves false when it
// can't be loaded, such as for a family Google doesn't have.
export function loadGoogleStylesheet(url: string) {
  let loaded = googleStylesheets.get(url);
  if (!loaded) {
    loaded = new Promise<boolean>((resolve) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.crossOrigin = "anonymous";
      link.onload = () => resolve(true);
      link.onerror = () => {
        link.remove();
        resolve(false);
      };
      document.head.append(link);
    });
    googleStylesheets.set(url, loaded);
  }
  return loaded;
}

// Whether a font installed on this machine is available, by comparing its
// text width with the generic families it would otherwise fall back to.
function isLocalFamilyAvailable(family: string) {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) {
    return true;
  }
  const sample = "mmmmmmmmmmlli10WQ@";
  return ["monospace", "serif", "sans-serif"].some((generic) => {
    context.font = `72px ${generic}`;
    const fallbackWidth = context.measureText(sample).width;
    context.font = `72px ${quoteFamily(family)}, ${generic}`;
    return context.measureText(sample).width !== fallbackWidth;
  });
}

async function loadFace(face: FontFace, fonts: FontFaceSet) {
  const choice = parseFontChoice(face.value);
  const spec = formatFontSpec(face, 32);
  if (choice.source === "local") {
    return isLocalFamilyAvailable(choice.family);
  }
  if (choice.source === "google") {
    // A family without the requested weight or style fails as a whole, so
    // fall back to the family's own defaults, which the browser synthesises
    // bold and italic from.
    const loaded =
      (await loadGoogleStylesheet(googleFontsCssUrl([choice.family], face))) ||
      (await loadGoogleStylesheet(googleFontsCssUrl([choice.family])));
    if (!loaded) {
      return false;
    }
  }
  const faces = await fonts.load(spec);
  return faces.length > 0;
}

/**
 * Whether the face can be drawn now. Starts loading it when it can't, and
 * notifies subscribers once it has loaded or turned out to be missing.
 * Always true outside a document, where there is nothing to load.
 */
export function isFontFaceReady(face: FontFace) {
  const fonts = getFontSet();
  if (!fonts) {
    return true;
  }
  const key = faceKey(face);
  const status = faceStatuses.get(key);
  if (status === "ready") {
    return true;
  }
  if (!status) {
    void loadFontFace(face);
  }
  return false;
}

/** Loads the face, resolving once it is ready or reported missing. */
export async function loadFontFace(face: FontFace) {
  const fonts = getFontSet();
  const key = faceKey(face);
  if (!fonts || faceStatuses.get(key) === "ready") {
    return;
  }
  faceStatuses.set(key, "loading");
  let available: boolean;
  try {
    available = await loadFace(face, fonts);
  } catch {
    available = false;
  }
  if (!available) {
    markMissing(face.value);
  }
  // A missing font is drawn in the default font from now on, so this face
  // no longer holds anything back.
  faceStatuses.set(key, "ready");
  notify();
}

export type LocalFontData = { family: string };

type LocalFontWindow = Window & {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
};

// Where installed fonts can be listed from: the Local Font Access API, or
// the native app's own command where the webview lacks it (WKWebView and
// WebKitGTK).
export type LocalFontSources = {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
  listNativeFontFamilies?: () => Promise<string[]>;
};

function getLocalFontSources(): LocalFontSources {
  if (typeof window === "undefined") {
    return {};
  }
  const query = (window as LocalFontWindow).queryLocalFonts;
  return {
    queryLocalFonts:
      typeof query === "function" ? () => query.call(window) : undefined,
    listNativeFontFamilies: isTauri()
      ? () => invoke<string[]>("list_font_families")
      : undefined,
  };
}

export function canQueryLocalFonts(sources = getLocalFontSources()) {
  return Boolean(sources.queryLocalFonts || sources.listNativeFontFamilies);
}

/**
 * Families installed on this machine, via the Local Font Access API, which
 * asks for permission first, or else the native app. Empty where neither is
 * available.
 */
export async function queryLocalFontFamilies(sources = getLocalFontSources()) {
  let families: string[] = [];
  if (sources.queryLocalFonts) {
    families = (await sources.queryLocalFonts()).map((font) => font.family);
  } else if (sources.listNativeFontFamilies) {
    families = await sources.listNativeFontFamilies();
  }
  return Array.from(new Set(families)).sort((left, right) =>
    left.localeCompare(right),
  );
}
