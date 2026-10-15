import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { DesktopShell } from "../../component-test/shells.tsx";
import { setViewport } from "../../component-test/viewport.ts";
import { useMediaDrawer } from "../../hooks/useMediaDrawer.ts";
import type { SessionLibraryState } from "../../hooks/useSessionLibrary.ts";
import type { MediaItem } from "../../media.ts";
import { createPlayheadSignal } from "../../playhead-signal.ts";
import { TimelineToolbar } from "../timeline/TimelineToolbar";
import { MediaDrawer } from "./MediaDrawer";
import { MEDIA_DRAWER_STORAGE_KEY } from "./media-drawer-model.ts";

// The Media drawer at the left of the timeline lists every linked media item
// in an icon or list view, with search, a thumbnail size slider, the item
// count and selection, opened and closed from the timeline toolbar. Details
// read from real files, offline sample media and keeping the drawer's state
// across a reload stay in e2e/media-drawer.spec.ts.
const noop = () => {};
const TIME_FORMAT = {
  timelineMode: "timecode",
  bpm: 120,
  signature: { numerator: 4, denominator: 4 },
  fps: 30,
} as const;

function mediaItem(
  id: string,
  name: string,
  kind: "video" | "audio",
): MediaItem {
  return {
    id,
    name,
    kind,
    durationSeconds: 3,
    hasAudio: kind === "audio",
    hasVideo: kind === "video",
    color: "#000",
    accent: "#fff",
    // No URL, so nothing decodes thumbnails or reads file details.
    previewUrl: "",
    availability: "ready",
  };
}

// A video and a WAV, as linked from e2e/fixtures.
const LINKED_MEDIA = [
  mediaItem("video", "test-pattern.mp4", "video"),
  mediaItem("tone", "tone.wav", "audio"),
];

// The editor grid's drawer column and the timeline beside it, under the
// toolbar whose Media button opens the drawer, as App lays them out.
function Editor({ mediaItems }: { mediaItems: MediaItem[] }) {
  const drawer = useMediaDrawer({ editorGridWidth: window.innerWidth });
  return (
    <DesktopShell>
      <TimelineToolbar
        bpm={120}
        commitProjectChange={noop}
        commitProjectPatch={noop}
        fps={30}
        isMediaDrawerOpen={drawer.isOpen}
        isPlaying={false}
        isRecording={false}
        mediaDrawerTab={drawer.tab}
        onSelectMediaDrawerTab={drawer.selectTab}
        playheadSignal={createPlayheadSignal()}
        signature={{ id: "4/4", numerator: 4, denominator: 4 }}
        signatureId="4/4"
        snapEnabled={false}
        timelineMode="timecode"
      />
      <div className="editor-grid" style={{ height: 600 }}>
        <MediaDrawer
          drawer={drawer}
          // Only the Sessions tab reads the library.
          library={{} as SessionLibraryState}
          mediaItems={mediaItems}
          onBackfillMediaDetails={noop}
          onImport={noop}
          onOpenMedia={noop}
          prefersReducedMotion={false}
          remoteMediaProgress={new Map()}
          timeFormat={TIME_FORMAT}
        />
        <div data-testid="timeline" />
      </div>
    </DesktopShell>
  );
}

beforeEach(() => {
  window.localStorage.removeItem(MEDIA_DRAWER_STORAGE_KEY);
});

function drawerElement() {
  return document.getElementById("media-drawer") as HTMLElement;
}

function drawerText() {
  return drawerElement().textContent;
}

function drawer() {
  return page.getByRole("complementary", { name: "Media" });
}

// Hidden: out of the accessibility tree and, once it has slid shut, not
// drawn.
async function expectDrawerHidden() {
  await expect.element(drawer()).not.toBeInTheDocument();
  await expect
    .poll(() => getComputedStyle(drawerElement()).visibility)
    .toBe("hidden");
}

function toggle() {
  return page.getByRole("button", { name: "Media", exact: true });
}

function items() {
  return drawer().getByRole("option");
}

function item(name: string) {
  return items().filter({ hasText: name });
}

function drawerWidth() {
  return drawerElement().getBoundingClientRect().width;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

// The drawer's width once its open/close animation has finished: two reads a
// frame apart agree.
async function settledWidth() {
  let previous = -1;
  for (;;) {
    const width = drawerWidth();
    if (width === previous) {
      return width;
    }
    previous = width;
    await nextFrame();
  }
}

test("the drawer is collapsed by default and opens and closes", async () => {
  await render(<Editor mediaItems={[]} />);
  await expect.element(toggle()).toHaveAttribute("aria-expanded", "false");
  await expectDrawerHidden();

  await toggle().click();
  await expect.element(toggle()).toHaveAttribute("aria-expanded", "true");
  await expect.element(drawer()).toBeVisible();
  await expect.poll(drawerText).toContain("No media yet");
  await expect
    .element(drawer().getByRole("button", { name: "Import Media" }))
    .toBeVisible();
  await expect.poll(drawerText).toContain("0 items");
  // The timeline gives up the drawer's width.
  await expect.poll(drawerWidth).toBeGreaterThan(200);

  await drawer().getByRole("button", { name: "Close media drawer" }).click();
  await expectDrawerHidden();
  await toggle().click();
  await expect.element(drawer()).toBeVisible();
  await toggle().click();
  await expectDrawerHidden();
});

// Many real presses, which a busy host makes slow.
test("lists, searches, sizes and selects linked media", {
  timeout: 30_000,
}, async () => {
  await render(<Editor mediaItems={LINKED_MEDIA} />);
  await toggle().click();

  // Both media items are listed; none is marked as a main audio track.
  await expect.poll(() => items().elements().length).toBe(2);
  await expect.poll(drawerText).toContain("2 items");
  const video = item("test-pattern");
  const tone = item("tone");
  expect(drawerText()).not.toContain("Audio track");

  // Search narrows the items and the count.
  const search = drawer().getByRole("textbox", { name: "Search media" });
  await search.fill("TONE");
  await expect.poll(() => items().elements().length).toBe(1);
  await expect.poll(drawerText).toContain("1 of 2 items");
  await search.fill("nothing like it");
  await expect.poll(() => items().elements().length).toBe(0);
  await expect.poll(drawerText).toContain("0 of 2 items");
  await drawer().getByRole("button", { name: "Clear search" }).click();
  await expect.element(search).toHaveValue("");
  await expect.poll(() => items().elements().length).toBe(2);
  await expect.poll(drawerText).toContain("2 items");

  // The slider scales the icon view's tiles.
  const slider = drawer().getByRole("slider", { name: "Thumbnail size" });
  await slider.fill("64");
  const small = video.element().getBoundingClientRect().width;
  await slider.fill("200");
  const large = video.element().getBoundingClientRect().width;
  expect(large).toBeGreaterThan(small + 100);

  // Click selects one item; arrows, Home and End move the selection.
  await video.click();
  await expect.element(video).toHaveAttribute("aria-selected", "true");
  await expect.element(tone).toHaveAttribute("aria-selected", "false");
  const listbox = drawer().getByRole("listbox");
  await expect.element(listbox).toHaveFocus();
  await userEvent.keyboard("{End}");
  await expect.element(tone).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Home}");
  await expect.element(video).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(tone).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(video).toHaveAttribute("aria-selected", "true");

  // The list view shows Kind and Duration columns.
  await drawer().getByRole("button", { name: "List" }).click();
  await expect
    .element(drawer().getByRole("button", { name: "List" }))
    .toHaveAttribute("aria-pressed", "true");
  await expect.element(video).toHaveClass(/media-row/);
  expect(
    video.element().querySelector(".media-row__kind")?.textContent,
  ).toMatch(/^Video/);
  expect(tone.element().querySelector(".media-row__kind")?.textContent).toBe(
    "Audio",
  );
  await expect.element(video).toHaveAttribute("aria-selected", "true");
  (listbox.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(tone).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{ArrowUp}");
  await expect.element(video).toHaveAttribute("aria-selected", "true");
});

test("the resize handle widens the drawer and double-click resets it", async () => {
  const screen = await render(<Editor mediaItems={[]} />);
  await toggle().click();
  const handle = page.getByRole("separator", { name: "Resize media drawer" });
  await expect.element(handle).toBeVisible();
  const before = await settledWidth();

  // Drags from the handle's center to 80px right of it, over the timeline.
  const box = handle.element().getBoundingClientRect();
  const timeline = screen.getByTestId("timeline");
  const target = timeline.element().getBoundingClientRect();
  await userEvent.dragAndDrop(handle, timeline, {
    targetPosition: {
      x: box.x + box.width / 2 + 80 - target.x,
      y: box.y + box.height / 2 - target.y,
    },
  });
  await expect.poll(drawerWidth).toBeGreaterThan(before + 60);

  await handle.dblClick();
  await expect.poll(drawerWidth).toBeLessThan(before + 4);
});

test("overlays the timeline as a sheet on narrow layouts", async () => {
  await setViewport({ width: 720, height: 900 });
  await render(<Editor mediaItems={[]} />);
  await expectDrawerHidden();

  await toggle().click();
  await expect.element(drawer()).toBeVisible();
  expect(getComputedStyle(drawerElement()).position).toBe("fixed");
  const handle = document.querySelector(".media-drawer-resize-handle");
  expect(handle?.checkVisibility()).toBe(false);
  // It slides in to the viewport's left edge, over the timeline.
  await expect.poll(() => drawerElement().getBoundingClientRect().x).toBe(0);
  const box = drawerElement().getBoundingClientRect();
  expect(box.y).toBe(0);
  expect(box.width).toBeLessThanOrEqual(720);

  await drawer().getByRole("button", { name: "Close media drawer" }).click();
  await expectDrawerHidden();
});

// A 64×64 Lottie at 30 fps, one second long, red for its first half and blue
// for its second.
function redThenBlueLottie() {
  const still = (k: unknown) => ({ a: 0, k });
  const solid = (ind: number, color: string, ip: number, op: number) => ({
    ddd: 0,
    ind,
    ty: 1,
    nm: color,
    sc: color,
    sw: 64,
    sh: 64,
    ip,
    op,
    st: 0,
    sr: 1,
    bm: 0,
    ks: {
      o: still(100),
      r: still(0),
      p: still([0, 0, 0]),
      a: still([0, 0, 0]),
      s: still([100, 100, 100]),
    },
  });
  return JSON.stringify({
    v: "5.7.0",
    fr: 30,
    ip: 0,
    op: 30,
    w: 64,
    h: 64,
    nm: "red then blue",
    ddd: 0,
    assets: [],
    layers: [solid(1, "#ff0000", 0, 15), solid(2, "#0000ff", 15, 30)],
  });
}

// The RGB at the middle of `image`.
function centerPixel(image: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(
    canvas.width >> 1,
    canvas.height >> 1,
    1,
    1,
  );
  return [data[0], data[1], data[2]];
}

// A Lottie's middle frame, drawn when it was imported, is an object URL a
// saved session can't keep (#1494), so the drawer draws it again.
test("draws a Lottie's middle frame when it has no thumbnail", async () => {
  const previewUrl = URL.createObjectURL(
    new Blob([redThenBlueLottie()], { type: "application/json" }),
  );
  try {
    const lottie: MediaItem = {
      ...mediaItem("lottie", "spinner.json", "video"),
      kind: "image",
      hasVideo: false,
      durationSeconds: 1,
      width: 64,
      height: 64,
      previewUrl,
    };
    const diag: string[] = [];
    const start = performance.now();
    const info = console.info;
    console.info = (...args: unknown[]) => {
      diag.push(`${(performance.now() - start).toFixed(0)}ms ${JSON.stringify(args)}`);
      info(...args);
    };
    await render(<Editor mediaItems={[lottie]} />);
    await toggle().click();
    diag.push(`clicked ${(performance.now() - start).toFixed(0)}ms`);
    try {
      await expect
        .poll(() => item("spinner").element().querySelector("img")?.src ?? "", { timeout: 30_000 })
        .toMatch(/^blob:/);
    } finally {
      diag.push(`img ${(performance.now() - start).toFixed(0)}ms ${item("spinner").element().innerHTML.slice(0, 300)}`);
      console.info = info;
    }
    if (performance.now() - start > 0) throw new Error(`DIAG ${diag.join("\n")}`);
    const shown = item("spinner")
      .element()
      .querySelector("img") as HTMLImageElement;
    await shown.decode();
    expect(centerPixel(shown)).toEqual([0, 0, 255]);
  } finally {
    URL.revokeObjectURL(previewUrl);
  }
});
