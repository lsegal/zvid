import { afterEach, describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
  emulateTouch,
  PHONE_LANDSCAPE_VIEWPORT,
  PHONE_VIEWPORT,
  setViewport,
  usePhone,
  useTablet,
} from "../../component-test/viewport.ts";
import {
  addClip,
  boxOf,
  centerOf,
  click,
  drag,
  findByRole,
  isVisible,
  playheadQ,
  query,
  renderApp,
  settled,
  tap,
  visibleByRole,
} from "../../mobile/phone-app-test-utils.tsx";
import { MobileShellChrome } from "./MobileShellChrome";
import { MobileTopBar } from "./MobileTopBar";

// The touch-first phone shell (#1168): a phone-sized touch viewport gets
// the mobile layout, while fine pointers and tablets keep the desktop one.
// These mount the whole editor, since the shell's layout and sheets follow
// the session's state.

const shown = (selector: string) => isVisible(document.querySelector(selector));

const clipCount = () => document.querySelectorAll(".clip-card").length;

afterEach(() => {
  vi.restoreAllMocks();
});

describe(MobileShellChrome.name, () => {
  test("a phone gets the mobile shell with no page scroll", async () => {
    await usePhone();
    await renderApp();
    expect(query(".app-shell").classList).toContain("app-shell--phone");
    expect(shown(".topbar")).toBe(false);
    expect(shown(".mobile-topbar")).toBe(true);
    expect(shown(".mobile-transport")).toBe(true);
    await findByRole("navigation", "Editor");
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(
      window.innerHeight,
    );
    // Preview first, then the transport, the timeline and the tabs.
    const preview = boxOf(".preview-monitor");
    const transport = boxOf(".mobile-transport");
    const timeline = boxOf(".timeline-panel");
    const tabs = boxOf(".mobile-tab-bar");
    expect(preview.bottom).toBeLessThanOrEqual(transport.top);
    expect(transport.bottom).toBeLessThanOrEqual(timeline.top);
    expect(timeline.bottom).toBeLessThanOrEqual(tabs.top);
  });

  test("FX opens as a half or full sheet and Media as a full screen", async () => {
    await usePhone();
    await renderApp();
    const tabs = await findByRole("navigation", "Editor");
    await click("button", "FX", { root: tabs });
    await expect.poll(() => shown(".fx-panel")).toBe(true);
    const half = boxOf(".fx-panel").height;
    await click("button", "Full height");
    await expect
      .poll(() => boxOf(".fx-panel").height)
      .toBeGreaterThan(half * 1.5);
    await click("button", "Animation", { exact: true });
    await click("button", "Close FX");
    await expect.poll(() => shown(".fx-panel")).toBe(false);

    await click("button", "Media", { root: tabs });
    await findByRole("button", "Camera roll");
    expect(boxOf(".media-drawer").width).toBe(PHONE_VIEWPORT.width);
    await click("button", "Close media");
    await expect
      .poll(() => visibleByRole("button", "Camera roll").length)
      .toBe(0);
  });

  // #1172: the FX sheet's header is a drag handle, and no drag in the app
  // starts the browser's pull-to-refresh.
  test("dragging the FX sheet's header moves it between heights", async () => {
    await usePhone();
    await renderApp();
    for (const element of [document.documentElement, document.body]) {
      expect(getComputedStyle(element).overscrollBehaviorY).toBe("none");
    }
    const tabs = await findByRole("navigation", "Editor");
    await click("button", "FX", { root: tabs });
    await expect.poll(() => shown(".fx-panel")).toBe(true);
    await settled(".fx-panel");
    const half = boxOf(".fx-panel").height;
    const height = () => boxOf(".fx-panel").height;

    const grabber = centerOf(".mobile-sheet-header__grabber");
    await drag(grabber, { x: grabber.x, y: grabber.y - 150 });
    await expect.poll(height).toBeGreaterThan(half * 1.5);
    await findByRole("button", "Half height");

    const title = centerOf(".mobile-sheet-header__title");
    await drag(title, { x: title.x, y: title.y + 150 });
    await expect.poll(height).toBeCloseTo(half, 0);

    // Tapping the grabber still toggles the height.
    await userEvent.click(query(".mobile-sheet-header__grabber"));
    await expect.poll(height).toBeGreaterThan(half * 1.5);
    await userEvent.click(query(".mobile-sheet-header__grabber"));
    await expect.poll(height).toBeCloseTo(half, 0);
    await settled(".fx-panel");

    const halfGrabber = centerOf(".mobile-sheet-header__grabber");
    await drag(halfGrabber, { x: halfGrabber.x, y: halfGrabber.y + 150 });
    await expect.poll(() => shown(".fx-panel")).toBe(false);
  });

  test("dragging a menu sheet's grabber down closes it", async () => {
    await usePhone();
    await renderApp();
    await click("button", "More", { exact: true });
    await expect.poll(() => shown(".mobile-menu-sheet")).toBe(true);
    await settled(".mobile-menu-sheet");
    const handle = centerOf(".mobile-sheet__handle");
    await drag(handle, { x: handle.x, y: handle.y + 20 });
    expect(shown(".mobile-menu-sheet")).toBe(true);
    await settled(".mobile-menu-sheet");
    await drag(handle, { x: handle.x, y: handle.y + 120 });
    await expect.poll(() => shown(".mobile-menu-sheet")).toBe(false);
  });

  // Menus open as sheets above the FX sheet (#1170, #1198), and selects
  // portal to <body> above it too. An open select blocks pointer events
  // everywhere else, so a hit test can't see a sheet drawn over it; compare
  // stacking instead.
  test("menus and selects in the FX sheet open above it", async () => {
    const zIndexOf = (element: Element) =>
      Number(getComputedStyle(element).zIndex) || 0;
    await usePhone();
    await renderApp();
    const tabs = await findByRole("navigation", "Editor");
    await click("button", "FX", { root: tabs });
    await expect.poll(() => shown(".fx-panel")).toBe(true);
    const fx = query(".fx-panel");
    const fxZ = zIndexOf(fx);

    await click("button", "Add device to Global", { root: fx });
    await expect.poll(() => shown(".mobile-menu-sheet")).toBe(true);
    expect(zIndexOf(query(".mobile-menu-sheet-layer"))).toBeGreaterThan(
      Math.max(fxZ, 90),
    );
    const sheet = query(".mobile-menu-sheet");
    await click("menuitem", "Transform", { root: sheet });
    await click("menuitem", /^Zoom & Pan/, { root: sheet });
    await expect.poll(() => shown(".mobile-menu-sheet")).toBe(false);

    await click("button", "Animation", { exact: true, root: fx });
    await click("combobox", "Motion In", { root: fx });
    await expect
      .poll(() => isVisible(document.querySelector('[role="listbox"]')))
      .toBe(true);
    const options = query('[role="listbox"]');
    const listZ = zIndexOf(
      options.closest("[data-radix-popper-content-wrapper]") ?? options,
    );
    expect(listZ).toBeGreaterThan(Math.max(fxZ, 90));
  });

  describe("landscape phone", () => {
    test("puts the preview left of the timeline", async () => {
      await usePhone(PHONE_LANDSCAPE_VIEWPORT);
      await renderApp();
      expect(query(".app-shell").classList).toContain(
        "app-shell--phone-landscape",
      );
      const preview = boxOf(".preview-monitor");
      const timeline = boxOf(".timeline-panel");
      expect(preview.x + preview.width).toBeLessThanOrEqual(timeline.x);
      expect(shown(".fx-panel")).toBe(false);
    });
  });

  describe("tablet", () => {
    test("keeps the desktop layout with a coarse pointer", async () => {
      await useTablet();
      await renderApp();
      expect(shown(".topbar")).toBe(true);
      expect(query(".app-shell").classList).not.toContain("app-shell--phone");
    });

    // Toolbar controls keep their desktop size and take a 44px-tall touch
    // through an invisible hit area that no neighbor's covers (#1186).
    test("keeps desktop-sized controls with 44px touch targets", async () => {
      // A mouse on the same window size.
      await useTablet();
      await emulateTouch(false);
      const desktop = await renderApp();
      const desktopSizes = controlSizes();
      await desktop.unmount();
      await emulateTouch();
      await renderApp();
      const sizes = controlSizes();
      expect(Object.keys(sizes)).toEqual(
        expect.arrayContaining([
          "Record",
          "Snap On",
          "Tempo",
          "Timeline",
          "Zoom in",
          "Play timeline",
        ]),
      );
      expect(sizes).toEqual(desktopSizes);

      const hits = touchControls().map((control) => {
        const box = control.getBoundingClientRect();
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        const hit = (dy: number) =>
          document.elementFromPoint(x, y + dy)?.closest("button") === control;
        return {
          name: control.getAttribute("aria-label") ?? control.textContent,
          center: hit(0),
          touch: hit(-21) && hit(21),
        };
      });
      expect(hits.length).toBeGreaterThan(5);
      for (const hit of hits) {
        expect(hit, String(hit.name)).toEqual({
          ...hit,
          center: true,
          touch: true,
        });
      }

      // Every other button still takes a tap at its own center.
      const stolen = Array.from(document.querySelectorAll("button"))
        .filter((button) => {
          const box = button.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) return false;
          if (getComputedStyle(button).visibility === "hidden") return false;
          const hit = document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          );
          return (
            hit !== null &&
            !button.contains(hit) &&
            hit.closest("button") !== null
          );
        })
        .map(
          (button) => button.getAttribute("aria-label") ?? button.textContent,
        );
      expect(stolen).toEqual([]);
    });
  });

  describe("narrow window with a mouse", () => {
    test("keeps the desktop layout", async () => {
      await setViewport(PHONE_VIEWPORT);
      await renderApp();
      expect(shown(".topbar")).toBe(true);
      expect(document.querySelectorAll(".mobile-tab-bar")).toHaveLength(0);
    });
  });
});

// The Sessions/Media/Record, Tempo/Time and Snap switches, the preview
// tabs, the menubar, the zoom buttons and the transport buttons (#1222).
const TOUCH_CONTROLS = [
  ".timeline-toolbar .segmented-control button",
  ".preview-panel__tabs button",
  ".menubar-item",
  ".zoom-control__button",
  ".transport-bar .transport-button",
].join(", ");

function touchControls() {
  return Array.from(
    document.querySelectorAll<HTMLElement>(TOUCH_CONTROLS),
  ).filter((control) => control.getClientRects().length > 0);
}

function controlSizes() {
  expect(shown(".topbar")).toBe(true);
  return Object.fromEntries(
    touchControls().map((control) => {
      const { width, height } = control.getBoundingClientRect();
      const name = control.getAttribute("aria-label") ?? control.textContent;
      return [String(name), { width, height }] as const;
    }),
  );
}

describe(MobileTopBar.name, () => {
  test("Undo and Redo are one tap away in the top bar", async () => {
    await usePhone();
    await renderApp();
    const topBar = query(".mobile-topbar");
    const undo = () => visibleByRole("button", /^Undo/, { root: topBar })[0];
    const redo = () => visibleByRole("button", /^Redo/, { root: topBar })[0];
    expect(undo().matches(":disabled")).toBe(true);
    expect(redo().matches(":disabled")).toBe(true);
    await addClip();
    expect(undo().matches(":disabled")).toBe(false);
    const scroll = centerOf(".timeline-scroll");
    const y = centerOf(".clip-card").y;
    await drag({ x: scroll.x + 60, y }, { x: scroll.x - 60, y });
    await expect.poll(playheadQ).toBeGreaterThan(1);
    await tap(query(".clip-card__body"));
    const toolbar = await findByRole("toolbar", "Clip actions");
    await click("button", "Split at playhead", { root: toolbar });
    await expect.poll(clipCount).toBe(2);
    // Named like the Edit menu's items.
    expect(undo().getAttribute("aria-label")).toBe("Undo Split clip");
    await tap(undo());
    await expect.poll(clipCount).toBe(1);
    await expect
      .poll(() => redo().getAttribute("aria-label"))
      .toBe("Redo Split clip");
    await tap(redo());
    await expect.poll(clipCount).toBe(2);
    await expect.poll(() => redo().matches(":disabled")).toBe(true);
  });

  test("the More sheet has the desktop File and Edit menus", async () => {
    await usePhone();
    await renderApp();
    const items = () =>
      Array.from(
        document.querySelectorAll(
          ".mobile-menu-sheet .mobile-menu-sheet__item:not(.mobile-menu-sheet__back) .mobile-menu-sheet__label",
        ),
        (item) => item.textContent,
      );
    const inSheet = () => ({ root: query(".mobile-menu-sheet") });
    await click("button", "More", { exact: true });
    await expect
      .poll(items)
      .toEqual([
        "File",
        "Edit",
        "Save to Library",
        "Reorder Layers",
        "Show Source Tracks",
      ]);
    await click("menuitem", "File", inSheet());
    await expect
      .poll(items)
      .toEqual([
        "New Session",
        "Open",
        "Import Media",
        "All Media Linked",
        "Media Storage…",
        "Session Settings…",
        "Connect to Share",
        "Save",
        "Export",
      ]);
    await click("menuitem", "Open", { exact: true, ...inSheet() });
    await expect.poll(items).toEqual(["Session…", "Sample"]);
    // Back to File.
    await userEvent.click(query(".mobile-menu-sheet__back"));
    // Records the file chooser instead of opening it.
    const chooser = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(function (this: HTMLInputElement) {});
    await click("menuitem", "Import Media", inSheet());
    await expect
      .poll(() => chooser.mock.contexts.some((input) => input.type === "file"))
      .toBe(true);
    await expect.poll(() => shown(".mobile-menu-sheet")).toBe(false);
    await click("button", "More", { exact: true });
    await click("menuitem", "File", inSheet());
    await click("menuitem", "Session Settings…", inSheet());
    await expect
      .poll(() => isVisible(document.querySelector('[role="dialog"]')))
      .toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect
      .poll(() => isVisible(document.querySelector('[role="dialog"]')))
      .toBe(false);

    await addClip();
    await click("button", "More", { exact: true });
    await click("menuitem", "Edit", { exact: true, ...inSheet() });
    await expect.poll(() => items()[0]).toMatch(/^Undo /);
    await userEvent.click(
      query(
        ".mobile-menu-sheet .mobile-menu-sheet__item:not(.mobile-menu-sheet__back)",
      ),
    );
    await expect.poll(clipCount).toBe(0);
  });

  test("the top bar's Export opens the export flow, or explains the desktop app", async () => {
    await usePhone();
    await renderApp();
    await addClip();
    const exportButton = visibleByRole("button", /^Export/, {
      root: query(".mobile-topbar"),
    })[0];
    expect(exportButton.textContent).toBe("Export");
    await expect
      .poll(() => exportButton.matches(":disabled"), { timeout: 15_000 })
      .toBe(false);
    const support = exportButton.getAttribute("data-export-support");
    await userEvent.click(exportButton);
    await findByRole(
      "heading",
      support === "supported" ? "Export" : "Download the zvid desktop app",
      { exact: true },
    );
  });
});
