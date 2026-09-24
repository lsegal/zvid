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

export type StatusTone = "info" | "error";

export type StatusMessage = {
  text: string;
  tone: StatusTone;
  // Sticky messages (e.g. export progress) stay until replaced.
  sticky?: boolean;
};

// How long an info message stays in the status bar before it clears.
export const STATUS_MESSAGE_TIMEOUT_MS = 8000;

// Status call sites report failures in plain text ("Export failed: …",
// "Unable to connect …"), so the tone is derived from the message itself.
const ERROR_STATUS_PATTERN = /\bfailed\b|^unable to\b|\binterrupted\b/i;

export function statusMessageTone(text: string): StatusTone {
  return ERROR_STATUS_PATTERN.test(text) ? "error" : "info";
}

// Info messages fade out after a timeout; errors and sticky messages persist
// until the next status replaces them.
export function statusMessageClears(message: StatusMessage): boolean {
  return message.tone === "info" && !message.sticky;
}
