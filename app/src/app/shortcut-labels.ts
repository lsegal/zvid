import { formatClipJumpShortcut } from "../clip-jump.ts";

export function getShortcutLabels() {
  if (typeof window === "undefined") {
    return {
      mac: false,
      undo: "Ctrl+Z",
      redo: "Ctrl+Shift+Z",
      sourceClipDrop: "Ctrl+click",
      clipJump: formatClipJumpShortcut(false),
    };
  }

  const navigatorWithPlatform = window.navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };
  const platform =
    navigatorWithPlatform.userAgentData?.platform ??
    window.navigator.platform ??
    "";
  const isMac = /mac/i.test(platform);
  return {
    mac: isMac,
    undo: isMac ? "Cmd+Z" : "Ctrl+Z",
    redo: isMac ? "Shift+Cmd+Z" : "Ctrl+Shift+Z",
    sourceClipDrop: isMac ? "Cmd+click" : "Ctrl+click",
    clipJump: formatClipJumpShortcut(isMac),
  };
}
