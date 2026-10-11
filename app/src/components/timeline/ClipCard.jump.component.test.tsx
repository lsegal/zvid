import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { getShortcutLabels } from "../../app/shortcut-labels.ts";
import {
  click,
  down,
  type Modifier,
  move,
  up,
} from "../../component-test/cdp-mouse.ts";
import {
  renderEditor,
  sessionWithLayers,
  withTestPatternTrack,
} from "../../component-test/editor-harness.tsx";
import { setViewport } from "../../component-test/viewport.ts";
import { ClipCard } from "./ClipCard";

// Ctrl-click on an arrangement clip (Cmd-click on macOS) selects it and
// moves the playhead to its start, seeking playback while it plays. Source
// clips keep Ctrl/Cmd-click for dropping onto the arrangement, and Ctrl-click
// on macOS stays a right-click. ClipCard takes the press; the editor harness
// wires its drag, menus and playback as App does.
void ClipCard;

// Ctrl, or Cmd on macOS, like Playwright's ControlOrMeta.
const MOD: Modifier = getShortcutLabels().mac ? "Meta" : "Control";

function lanes() {
  return [...document.querySelectorAll<HTMLElement>("[data-timeline-lane-id]")];
}

function clipCard() {
  const clip = document.querySelector<HTMLElement>(".clip-card");
  if (!clip) {
    throw new Error("No clip");
  }
  return clip;
}

function clipBody() {
  return clipCard().querySelector(".clip-card__body") as HTMLElement;
}

function clipLaneId() {
  return clipCard()
    .closest<HTMLElement>("[data-timeline-lane-id]")
    ?.getAttribute("data-timeline-lane-id");
}

function otherLane() {
  const lane = lanes().find((element) => !element.querySelector(".clip-card"));
  if (!lane) {
    throw new Error("Every layer has a clip");
  }
  return lane;
}

// The playhead's left edge within the lane, independent of scroll.
function playheadX() {
  const marker = document.querySelector(".timeline-playhead-marker");
  if (!marker) {
    throw new Error("No playhead");
  }
  return (
    marker.getBoundingClientRect().left - lanes()[0].getBoundingClientRect().left
  );
}

// The clip's left edge within the lane.
function clipX() {
  return (
    clipCard().getBoundingClientRect().x - lanes()[0].getBoundingClientRect().x
  );
}

// The marker's left edge sits a couple of pixels off a clip's border.
function distanceToClipStart(startX: number) {
  return Math.abs(playheadX() - startX);
}

// A plain click on another layer, under the middle of the clip, seeks there
// without selecting the clip.
async function seekIntoClip() {
  // Back to the top, so the sticky ruler doesn't cover the lane once the
  // timeline has scrolled down to the source clip.
  const scroll = document.querySelector(".timeline-scroll");
  if (scroll) {
    scroll.scrollTop = 0;
  }
  const clipBox = clipCard().getBoundingClientRect();
  const laneBox = otherLane().getBoundingClientRect();
  await click(clipBox.x + clipBox.width / 2, laneBox.y + 20);
}

// Well past the clip start, clear of the trim handles.
function jumpPoint() {
  const box = clipBody().getBoundingClientRect();
  return { x: box.x + box.width * 0.75, y: box.y + box.height / 2 };
}

// Opens a session with Layers 1 and 2 and the test pattern in a source
// track, and Ctrl/Cmd-clicks it onto the arrangement.
async function addVideoClip(modifier: Modifier) {
  await renderEditor({
    project: withTestPatternTrack(sessionWithLayers(2)),
  });
  await expect
    .poll(() => document.querySelectorAll(".source-span").length)
    .toBe(1);
  const span = document.querySelector(".source-span") as HTMLElement;
  // Ctrl/Cmd-click on a source clip still drops it on the arrangement.
  await userEvent.click(page.elementLocator(span), { modifiers: [modifier] });
  await expect
    .poll(() => document.querySelectorAll(".clip-card").length)
    .toBe(1);
}

// Reports macOS, as Safari and Chrome on a Mac do, until the returned
// function restores the browser's own platform.
function reportMacOS() {
  const keys = ["platform", "userAgentData"] as const;
  const originals = keys.map((key) =>
    Object.getOwnPropertyDescriptor(Navigator.prototype, key),
  );
  Object.defineProperty(Navigator.prototype, "platform", {
    configurable: true,
    get: () => "MacIntel",
  });
  Object.defineProperty(Navigator.prototype, "userAgentData", {
    configurable: true,
    get: () => ({ platform: "macOS" }),
  });
  return () => {
    keys.forEach((key, index) => {
      const original = originals[index];
      if (original) {
        Object.defineProperty(Navigator.prototype, key, original);
      } else {
        delete (Navigator.prototype as unknown as Record<string, unknown>)[key];
      }
    });
  };
}

describe("ClipCard jump to start", () => {
  let restorePlatform: (() => void) | undefined;

  beforeEach(async () => {
    await setViewport({ width: 1600, height: 1200 });
  });

  afterEach(() => {
    restorePlatform?.();
    restorePlatform = undefined;
  });

  test("Ctrl/Cmd-click on a clip selects it and jumps the playhead to its start", async () => {
    await addVideoClip(MOD);
    const laneId = clipLaneId();
    expect(clipBody().title).toMatch(/\+click to jump to start/);

    const startX = clipX();
    await seekIntoClip();
    expect(clipCard().className).not.toMatch(/clip-card--selected/);
    await expect.poll(playheadX).toBeGreaterThan(startX + 40);

    // Stopped: the playhead jumps to the clip start and the clip is selected.
    const point = jumpPoint();
    await click(point.x, point.y, { modifiers: [MOD] });
    await expect.poll(() => clipCard().className).toMatch(/clip-card--selected/);
    await expect.poll(() => distanceToClipStart(startX)).toBeLessThan(3);
    // The click neither duplicated nor moved the clip.
    expect(document.querySelectorAll(".clip-card").length).toBe(1);
    expect(clipX()).toBe(startX);
    expect(clipLaneId()).toBe(laneId);

    // Playing: playback seeks to the clip start and keeps going.
    await seekIntoClip();
    await expect.poll(playheadX).toBeGreaterThan(startX + 40);
    await userEvent.click(page.getByRole("button", { name: "Play timeline" }));
    const pause = page.getByRole("button", { name: "Pause playback" });
    await expect.element(pause).toBeVisible();
    const playingPoint = jumpPoint();
    await click(playingPoint.x, playingPoint.y, { modifiers: [MOD] });
    await expect.poll(playheadX).toBeLessThan(startX + 20);
    await expect.element(pause).toBeVisible();
    const afterSeek = playheadX();
    await expect.poll(playheadX).toBeGreaterThan(afterSeek + 2);
    await userEvent.click(pause);
  });

  test("the clip menu's Jump to start moves the playhead to the clip start", async () => {
    await addVideoClip(MOD);
    const startX = clipX();
    await seekIntoClip();
    await expect.poll(playheadX).toBeGreaterThan(startX + 40);

    await userEvent.click(page.elementLocator(clipBody()), { button: "right" });
    const item = page.getByRole("menuitem", { name: /Jump to start/ });
    await expect.element(item).toHaveTextContent(/(Ctrl|Cmd)\+click/);
    await userEvent.click(item);
    await expect.poll(() => clipCard().className).toMatch(/clip-card--selected/);
    await expect.poll(() => distanceToClipStart(startX)).toBeLessThan(3);
  });

  test("on macOS Cmd-click jumps and Ctrl-click opens the clip menu", async () => {
    restorePlatform = reportMacOS();
    await addVideoClip("Meta");
    expect(clipBody().title).toBe("Cmd+click to jump to start");
    const startX = clipX();
    const { x, y } = jumpPoint();

    // Ctrl-click is a right-click that opens the menu: macOS sends a
    // primary-button press with Ctrl, then contextmenu.
    await seekIntoClip();
    await expect.poll(playheadX).toBeGreaterThan(startX + 40);
    await userEvent.keyboard("{Control>}");
    await move(x, y, { modifiers: ["Control"] });
    await down({ modifiers: ["Control"] });
    clipBody().dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 0,
        ctrlKey: true,
        clientX: x,
        clientY: y,
      }),
    );
    await up({ modifiers: ["Control"] });
    await userEvent.keyboard("{/Control}");
    const menu = page.getByRole("menu");
    await expect.element(menu).toBeVisible();
    await expect
      .element(page.getByRole("menuitem", { name: /Jump to start/ }))
      .toHaveTextContent("Cmd+click");
    await userEvent.keyboard("{Escape}");
    await expect.element(menu).not.toBeInTheDocument();

    // Cmd-click jumps.
    await click(x, y, { modifiers: ["Meta"] });
    await expect.poll(() => clipCard().className).toMatch(/clip-card--selected/);
    await expect.poll(() => distanceToClipStart(startX)).toBeLessThan(3);
    expect(document.querySelectorAll(".clip-card").length).toBe(1);
  });
});
