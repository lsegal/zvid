import { BLACK_BORDER, type CompositionOrder } from "./composition-order.ts";

// What the composite shows where no layer is drawn.
const BACKGROUND_COLOR = [0.07, 0.08, 0.11, 1] as const;

type ClearColor = readonly [number, number, number, number];

// An Order's border color for `gl.clearColor`, unpremultiplied.
export function borderClearColor(order: CompositionOrder): ClearColor {
  const { r, g, b, a } = order.borderColor ?? BLACK_BORDER;
  return [r / 255, g / 255, b / 255, Math.max(0, Math.min(1, a))];
}

// What the canvas is cleared to: the background, under the Global Order's
// border color when there is an Order, so a translucent border shows the
// background through it.
export function sceneClearColor(order: CompositionOrder): ClearColor {
  if (order.arrangement === "none") {
    return BACKGROUND_COLOR;
  }

  const border = borderClearColor(order);
  const alpha = border[3];
  return [
    border[0] * alpha + BACKGROUND_COLOR[0] * (1 - alpha),
    border[1] * alpha + BACKGROUND_COLOR[1] * (1 - alpha),
    border[2] * alpha + BACKGROUND_COLOR[2] * (1 - alpha),
    1,
  ];
}
