import type { StatusItemProvider } from "../registry.ts";

// `120` -> `120`, `92.456` -> `92.46`.
function formatBpm(bpm: number) {
  return `${Math.round(bpm * 100) / 100}`;
}

// The ruler and the tempo.
export const timelineStatusItem: StatusItemProvider = {
  id: "timeline",
  order: 30,
  items: (state) => {
    const isMusical = state.timelineMode === "musical";
    const bpm = formatBpm(state.bpm);
    return [
      {
        id: "timeline",
        label: isMusical ? "Tempo" : "SMPTE",
        value: `${bpm} BPM`,
        title: `Timeline: ${isMusical ? "Tempo" : "SMPTE"} ruler, ${bpm} BPM`,
      },
    ];
  },
};
