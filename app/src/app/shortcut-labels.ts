import { formatClipJumpShortcut } from "../clip-jump.ts";

export function getShortcutLabels() {
  if (typeof window === "undefined") {
    return {
      mac: false,
      undo: "Ctrl+Z",
      redo: "Ctrl+Shift+Z",
      save: "Ctrl+S",
      newSession: "Ctrl+N",
      sourceClipDrop: "Ctrl+click",
      clipJump: formatClipJumpShortcut(false),
      lockLoop: "L",
      skipBack: "Ctrl+Left",
      skipForward: "Ctrl+Right",
      playFromLoopStart: "Ctrl+click",
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
    save: isMac ? "Cmd+S" : "Ctrl+S",
    newSession: isMac ? "Cmd+N" : "Ctrl+N",
    sourceClipDrop: isMac ? "Cmd+click" : "Ctrl+click",
    clipJump: formatClipJumpShortcut(isMac),
    lockLoop: "L",
    skipBack: isMac ? "Cmd+Left" : "Ctrl+Left",
    skipForward: isMac ? "Cmd+Right" : "Ctrl+Right",
    playFromLoopStart: isMac ? "Cmd+click" : "Ctrl+click",
  };
}
