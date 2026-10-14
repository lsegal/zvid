import { afterEach, describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { DesktopShell } from "../component-test/shells.tsx";
import type { CollaborationStateResult } from "../hooks/useCollaboration.ts";
import { markInstalledApp } from "../installed-app.ts";
import { TopBar, type TopBarProps } from "./TopBar";

// The desktop top bar is compact, and drops its brand mark when zvid runs as
// an installed app, whose title bar already shows the zvid icon and name
// (#1200).

const noop = () => {};
const setOpen = noop as TopBarProps["setIsMediaStorageDialogOpen"];

// An idle session's collaboration state, as far as the top bar reads it.
const collaboration = {
  collaborationMode: "idle",
  collaborationView: { stateLabel: "Not connected", stateTone: "idle" },
  hasCopiedShareInvite: false,
  isConnectedClient: false,
  isSharing: false,
  isStartingShare: false,
  setIsConnectDialogOpen: noop,
  setIsDiagnosticsDialogOpen: noop,
  setIsShareDialogOpen: noop,
  shareUrl: "",
} as unknown as CollaborationStateResult;

const props: TopBarProps = {
  canStartNewSession: true,
  handleNewSession: noop,
  handleOpenSession: async () => {},
  sample: { openSample: noop },
  handleImport: async () => {},
  offlineMedia: [],
  showsMediaSync: false,
  collaboration,
  handleDisconnectConnection: noop,
  handleSaveToLibrary: async () => true,
  isExporting: false,
  openExportDialog: noop,
  setIsMediaStorageDialogOpen: setOpen,
  setIsMediaSyncDialogOpen: setOpen,
  setIsOfflineMediaDialogOpen: setOpen,
  setIsProjectExportDialogOpen: setOpen,
  setIsSessionSettingsOpen: setOpen,
  handleStopShare: noop,
  showShareCopiedBadge: noop,
  exportButtonLabel: "Export",
  getEditMenuEntries: () => [],
  renamingLaneIdRef: { current: undefined },
  setIsCaptureInstallerDialogOpen: setOpen,
  setStatus: noop,
};

function renderTopBar() {
  return render(
    <DesktopShell>
      <TopBar {...props} />
    </DesktopShell>,
  );
}

function box(selector: string) {
  const found = document.querySelector(selector);
  if (!found) throw new Error(`${selector} has no box`);
  return found.getBoundingClientRect();
}

// The vertical centers of the menubar and the right-hand controls agree.
function expectControlsCentered() {
  const centers = [
    ".topbar__menubar",
    ".topbar__group--right .collaboration-status",
    ".topbar__group--right button",
  ].map((selector) => {
    const { y, height } = box(selector);
    return y + height / 2;
  });
  for (const center of centers) {
    expect(Math.abs(center - centers[0])).toBeLessThan(2);
  }
}

// Reports the page as an iOS home screen app, as main.tsx checks before the
// first render.
function emulateIosStandalone() {
  Object.defineProperty(Navigator.prototype, "standalone", {
    configurable: true,
    get: () => true,
  });
  markInstalledApp();
}

afterEach(() => {
  Reflect.deleteProperty(Navigator.prototype, "standalone");
  document.documentElement.classList.remove("installed-app");
});

// The display modes whose @media rules hide the top bar's brand mark.
// Chromium can't emulate display-mode (CDP ignores it), so this reads the
// rules from the page's style sheets.
function hidingDisplayModes() {
  const modes = new Set<string>();
  const rules = (sheet: CSSStyleSheet) => {
    try {
      return Array.from(sheet.cssRules);
    } catch {
      return [];
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of rules(sheet)) {
      if (!(rule instanceof CSSMediaRule)) continue;
      const hides = Array.from(rule.cssRules).some(
        (inner) =>
          inner instanceof CSSStyleRule &&
          inner.selectorText === ".topbar button.brand-mark" &&
          inner.style.display === "none",
      );
      if (!hides) continue;
      for (const match of rule.media.mediaText.matchAll(
        /\(display-mode: ([a-z-]+)\)/g,
      )) {
        modes.add(match[1]);
      }
    }
  }
  return [...modes].sort();
}

describe("TopBar when installed", () => {
  test("in a browser tab the top bar is compact and keeps its brand mark", async () => {
    const screen = await renderTopBar();
    await expect.element(screen.getByRole("menubar")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /^zvid, build/ }))
      .toBeVisible();

    // 6 px of padding above and below the tallest group (#1220).
    const bar = box(".topbar");
    const groups = [box(".topbar__group"), box(".topbar__group--right")];
    const content = Math.max(...groups.map((group) => group.height));
    expect(bar.height - content).toBeCloseTo(12, 0);
    expectControlsCentered();
  });

  test("installed display modes hide the brand mark from the first paint", async () => {
    const screen = await renderTopBar();
    await expect.element(screen.getByRole("menubar")).toBeVisible();
    // Not fullscreen: a browser tab in fullscreen matches it too.
    expect(hidingDisplayModes()).toEqual([
      "minimal-ui",
      "standalone",
      "window-controls-overlay",
    ]);
  });

  test("an iOS home screen app hides the brand mark and starts File at the left edge", async () => {
    emulateIosStandalone();
    expect(document.documentElement.classList).toContain("installed-app");
    const screen = await renderTopBar();
    await expect.element(screen.getByRole("menubar")).toBeVisible();
    const brandMark = screen.container.querySelector(".topbar .brand-mark");
    expect(brandMark).not.toBeNull();
    expect(getComputedStyle(brandMark as Element).display).toBe("none");

    // No bar padding before File (#1220), only the menu item's own; the
    // right side keeps its 24 px.
    const bar = box(".topbar");
    const menubar = box(".topbar__menubar");
    const right = box(".topbar__group--right");
    expect(menubar.x - bar.x).toBeCloseTo(0, 0);
    expect(bar.x + bar.width - (right.x + right.width)).toBeCloseTo(24, 0);
    expectControlsCentered();

    await screen.getByRole("menuitem", { name: "File", exact: true }).click();
    await expect.element(screen.getByRole("menu")).toBeVisible();
  });
});
