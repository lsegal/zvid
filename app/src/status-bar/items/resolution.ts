import type { StatusItemProvider } from "../registry.ts";

export const resolutionStatusItem: StatusItemProvider = {
  id: "resolution",
  order: 50,
  items: ({ canvasWidth, canvasHeight }) => [
    {
      id: "resolution",
      label: "Res",
      value: `${canvasWidth}x${canvasHeight}`,
      title: `Resolution: ${canvasWidth} x ${canvasHeight}`,
    },
  ],
};
