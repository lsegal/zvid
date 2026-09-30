import { formatFrameRate } from "../../session-settings.ts";
import type { StatusItemProvider } from "../registry.ts";

// The canvas size and frame rate.
export const resolutionStatusItem: StatusItemProvider = {
  id: "resolution",
  order: 50,
  items: ({ canvasWidth, canvasHeight, fps: frameRate }) => {
    const fps = formatFrameRate(frameRate);
    return [
      {
        id: "resolution",
        label: "Res",
        value: `${canvasWidth}x${canvasHeight} · ${fps} fps`,
        title: `Resolution: ${canvasWidth} x ${canvasHeight} at ${fps} fps`,
      },
    ];
  },
};
