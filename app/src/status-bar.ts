import type { ReactNode } from "react";

export type StatusItem = {
  id: string;
  label?: string;
  value: ReactNode;
  title?: string;
  align?: "start" | "end";
};

// Splits status items into the leading and trailing groups of the bar while
// preserving each group's original order. Items default to the start group.
export function partitionStatusItems(items: readonly StatusItem[]) {
  const start: StatusItem[] = [];
  const end: StatusItem[] = [];
  for (const item of items) {
    (item.align === "end" ? end : start).push(item);
  }
  return { start, end };
}
