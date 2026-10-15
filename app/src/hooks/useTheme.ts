import { useSyncExternalStore } from "react";
import { getTheme, subscribeTheme } from "../theme.ts";

/** The applied theme, re-rendering when it switches. */
export function useTheme() {
  return useSyncExternalStore(subscribeTheme, getTheme, () => "dark" as const);
}
