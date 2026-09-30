import { buildPlayheadStatusItem } from "../../status-items.ts";
import type { StatusItemProvider } from "../registry.ts";

export const playheadStatusItem: StatusItemProvider = {
  id: "playhead",
  order: 40,
  items: (state) => [buildPlayheadStatusItem(state)],
};
