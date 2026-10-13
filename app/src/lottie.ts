// Lottie animations, imported as image media from their `.json` file or a
// dotLottie (`.lottie`) archive. Other JSON files, such as sessions, are told
// apart by their content: a Lottie names its frame rate, its in and out
// frames, its size and its layers.

export type LottieData = {
  fr: number;
  ip: number;
  op: number;
  w: number;
  h: number;
  layers: unknown[];
};

const isPositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** Whether the file `name` may hold a Lottie animation. */
export function isLottieName(name: string) {
  const lower = name.toLowerCase();
  return lower.endsWith(".json") || lower.endsWith(".lottie");
}

/** `value` as a Lottie animation, or undefined when it isn't one. */
export function asLottieData(value: unknown): LottieData | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const data = value as Partial<LottieData>;
  return isPositive(data.fr) &&
    typeof data.ip === "number" &&
    typeof data.op === "number" &&
    data.op > data.ip &&
    isPositive(data.w) &&
    isPositive(data.h) &&
    Array.isArray(data.layers)
    ? (data as LottieData)
    : undefined;
}

/** The Lottie animation in the JSON `text`, or undefined. */
export function parseLottie(text: string) {
  try {
    return asLottieData(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/** How many frames `data` plays. */
export function lottieFrameCount(data: LottieData) {
  return Math.max(1, Math.ceil(data.op - data.ip));
}

/** The length of `data`'s animation, in seconds. */
export function lottieSeconds(data: LottieData) {
  return (data.op - data.ip) / data.fr;
}

/**
 * The frame of `data`, counted from its in frame, showing `seconds` into
 * it, looping past its end.
 */
export function lottieFrameIndex(data: LottieData, seconds: number) {
  const count = lottieFrameCount(data);
  const frame = Math.floor(seconds * data.fr + 1e-6) % count;
  return frame < 0 ? frame + count : frame;
}
