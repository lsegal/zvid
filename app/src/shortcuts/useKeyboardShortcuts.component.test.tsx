import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import testPatternUrl from "../../e2e/fixtures/test-pattern.mp4?url";
import { INITIAL_PROJECT_STATE } from "../app/constants.ts";
import type { ProjectState } from "../app/types.ts";
import {
  insertTextClip,
  renderTimelineEditor,
  TIMELINE_EDITOR_TIMEOUT,
} from "../component-test/timeline-editor.tsx";
import {
  center,
  click,
  down,
  move,
  up,
} from "../component-test/timeline-mouse.ts";
import { setViewport } from "../component-test/viewport.ts";
import type { MediaItem } from "../media";
import { addMediaToSourceTrack } from "../source-track-media.ts";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts.ts";

// The keyboard shortcuts work after loading the editor, and after a press on
// the timeline takes the focus off a text field or slider that had it. The
// timeline cancels the browser's default for its presses, which used to
// leave the focus, and so every shortcut key, in that field (#926).

function lane(id: string) {
  return document.querySelector(
    `[data-timeline-lane-id="${id}"]`,
  ) as HTMLElement;
}

const playButton = () => page.getByRole("button", { name: "Play timeline" });
const pauseButton = () => page.getByRole("button", { name: "Pause playback" });
const textField = () =>
  page
    .getByRole("region", { name: "Text" })
    .getByRole("textbox", { name: "Text" });
const zoomSlider = () => page.getByRole("slider", { name: "Timeline zoom" });

// The playhead's left edge within the lanes, independent of scroll.
function playheadX() {
  const marker = document.querySelector(
    ".timeline-playhead-marker",
  ) as HTMLElement;
  return (
    marker.getBoundingClientRect().left - lane("1").getBoundingClientRect().left
  );
}

async function drawSelection(target: HTMLElement, fromX: number, toX: number) {
  const bounds = target.getBoundingClientRect();
  const y = bounds.y + 20;
  await move(bounds.x + fromX, y);
  await down();
  await move(bounds.x + toX, y, { steps: 4 });
  await up();
  await expect
    .poll(() => target.querySelectorAll(".timeline-selection").length)
    .toBe(1);
  return () => target.querySelectorAll(".timeline-selection").length;
}

// Adds Layer 2 and Layer 3 below Layer 1 from the header menu, as the e2e
// specs' addLayers does.
async function addLayers() {
  for (const id of ["2", "3"]) {
    const headers = document.querySelectorAll<HTMLElement>(
      "[data-layer-header-id]",
    );
    const last = center(headers[headers.length - 1]);
    await click(last.x, last.y, { button: "right" });
    const item = page
      .getByRole("menu", { name: "Layer header actions" })
      .getByRole("menuitem", { name: "Insert layer below", exact: true });
    await expect.element(item).toBeVisible();
    await click(center(item.element()).x, center(item.element()).y);
    await expect.poll(() => lane(id)).not.toBeNull();
  }
}

// Home and End jump the playhead, the arrows step it, and Space plays and
// stops.
async function expectTransportShortcuts() {
  await userEvent.keyboard("{End}");
  await expect.poll(playheadX).toBeGreaterThan(100);
  const end = playheadX();
  await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
  await expect.poll(playheadX).toBeLessThan(end);
  await userEvent.keyboard("{Home}");
  await expect.poll(playheadX).toBeLessThan(5);

  await expect.element(playButton()).toBeVisible();
  await userEvent.keyboard(" ");
  await expect.element(pauseButton()).toBeVisible();
  await userEvent.keyboard(" ");
  await expect.element(playButton()).toBeVisible();
}

// The e2e specs' four-second test pattern, in a source track of its own.
function sessionWithTestPattern(): Partial<ProjectState> {
  const media: MediaItem = {
    id: "media-test-pattern",
    name: "test-pattern.mp4",
    kind: "video",
    durationSeconds: 4,
    width: 160,
    height: 90,
    fps: 15,
    hasAudio: false,
    hasVideo: true,
    color: "#3d4052",
    accent: "#7ca1ff",
    previewUrl: testPatternUrl,
    availability: "ready",
  };
  return {
    mediaItems: [media],
    ...addMediaToSourceTrack(INITIAL_PROJECT_STATE, [media], {
      kind: "new-track",
    }),
  };
}

// Layers: "1" is Layer 1, and addLayers adds "2" (Layer 2) and "3" (Layer
// 3).
async function renderWithLayers(project?: Partial<ProjectState>) {
  await renderTimelineEditor({ project });
  await addLayers();
  (document.querySelector(".timeline-scroll") as HTMLElement).scrollLeft = 0;
}

describe(useKeyboardShortcuts, { timeout: TIMELINE_EDITOR_TIMEOUT }, () => {
  // The three layers all fit at this size.
  beforeEach(async () => {
    await setViewport({ width: 1600, height: 1200 });
  });

  test("shortcuts work after loading the editor", async () => {
    await renderWithLayers();
    await insertTextClip(40, 260);
    const clip = lane("1").querySelector(".clip-card--text") as HTMLElement;
    const scroll = (
      document.querySelector(".timeline-scroll") as HTMLElement
    ).getBoundingClientRect();
    await click(scroll.x + 5, scroll.y + 5);
    await expectTransportShortcuts();

    // Escape drops a drawn selection, then deselects the clip.
    const selections = await drawSelection(lane("2"), 40, 200);
    await userEvent.keyboard("{Escape}");
    await expect.poll(selections).toBe(0);
    await click(center(clip).x, center(clip).y);
    await expect.poll(() => clip.className).toMatch(/clip-card--selected/);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => clip.className).not.toMatch(/clip-card--selected/);
  });

  // A press on lane space would deselect the clip and close its Text field,
  // so the ruler, which keeps the clip selected, presses outside it.
  test("a press on the ruler takes the focus off a text field", async () => {
    await renderWithLayers();
    await insertTextClip(40, 260);
    const clip = lane("1").querySelector(".clip-card--text") as HTMLElement;
    const text = textField();
    await userEvent.fill(text, "Title");
    await expect.element(text).toHaveFocus();

    const ruler = (
      document.querySelector(".ruler-row") as HTMLElement
    ).getBoundingClientRect();
    await click(ruler.x + 400, ruler.y + ruler.height / 2);
    await expect.element(text).not.toHaveFocus();
    expect(clip.className).toMatch(/clip-card--selected/);
    await expectTransportShortcuts();
    await expect.element(text).toHaveValue("Title");
    await expect
      .poll(() => clip.querySelector("strong")?.textContent)
      .toBe("Title");

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => clip.className).not.toMatch(/clip-card--selected/);
  });

  test("a press on a lane takes the focus off the zoom slider", async () => {
    await renderWithLayers();
    await insertTextClip(40, 260);
    const zoom = zoomSlider();
    (zoom.element() as HTMLElement).focus();
    await expect.element(zoom).toHaveFocus();
    const zoomValue = (zoom.element() as HTMLInputElement).value;

    const layer3 = lane("3").getBoundingClientRect();
    await click(layer3.x + 500, layer3.y + 20);
    await expect.element(zoom).not.toHaveFocus();
    await expectTransportShortcuts();
    await expect.element(zoom).toHaveValue(zoomValue);
  });

  test("a number key commits a selection drawn with the zoom slider focused", async () => {
    await renderWithLayers(sessionWithTestPattern());
    const zoom = zoomSlider();
    (zoom.element() as HTMLElement).focus();
    await expect.element(zoom).toHaveFocus();

    const selections = await drawSelection(lane("2"), 40, 200);
    await expect.element(zoom).not.toHaveFocus();
    await userEvent.keyboard("1");
    await expect.poll(selections).toBe(0);
    await expect
      .poll(() => lane("2").querySelectorAll(".clip-card").length)
      .toBe(1);
  });
});
