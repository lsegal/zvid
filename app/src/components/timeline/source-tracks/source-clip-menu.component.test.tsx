import { beforeEach, expect, test } from "vitest";
import { type Locator, page, userEvent } from "vitest/browser";
import {
  addLayers,
  dropFiles,
  expectCount,
  fileTransfer,
  fixtureFile,
  mouse,
  nextFrame,
  pressMod,
  query,
  queryAll,
  renderApp,
} from "../../../component-test/app.tsx";
import { setViewport } from "../../../component-test/viewport.ts";

// The source clip menu has the layer clip menu's Jump to start, Cut, Copy,
// Paste, Duplicate, Split at playhead and Delete, acting within the source
// track, then Copy to layer (#699). Mod+E never splits a source clip. A
// four-second test pattern at 120 BPM spans eight quarters.

const TIMEOUT = 60_000;

async function dropVideoIntoNewSourceTrack() {
  await dropFiles(
    query('[data-source-track-drop-target="new-track"]'),
    fileTransfer([await fixtureFile("test-pattern.mp4")]),
  );
  await expectCount(".source-span", 1);
}

function lane(id: string) {
  return query(`[data-timeline-lane-id="${id}"]`);
}

function spans() {
  return queryAll(".source-span");
}

function firstSpan() {
  return query(".source-span");
}

function lastSpan() {
  const span = spans().at(-1);
  if (!span) throw new Error("missing .source-span");
  return span;
}

function menuItem(name: string | RegExp) {
  return page.getByRole("menuitem", { name });
}

function editMenu() {
  return page.getByRole("menuitem", { name: "Edit", exact: true });
}

function expectSelected(span: () => Element) {
  return expect
    .poll(() => span().classList.contains("source-span--selected"))
    .toBe(true);
}

function expectDisabled(item: Locator) {
  return expect.element(item).toHaveAttribute("aria-disabled", "true");
}

function settle() {
  return nextFrame().then(nextFrame);
}

// Scrolling closes an open menu, so bring the target into view (and let its
// scroll event fire) before right-clicking it.
async function rightClick(element: Element) {
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
  await settle();
  await userEvent.click(element, { button: "right" });
}

async function openMenu(span: Element) {
  await rightClick(span);
  await expect.element(menuItem(/^Copy to layer/)).toBeVisible();
}

// Each span's left edge and width, in timeline pixels.
function layout() {
  return spans()
    .map((element) => ({
      left: Number.parseFloat(element.style.left),
      width: element.getBoundingClientRect().width,
    }))
    .sort((a, b) => a.left - b.left);
}

// The playhead's left edge within the lane, independent of scroll.
function playheadX() {
  return (
    query(".timeline-playhead-marker").getBoundingClientRect().left -
    query("[data-timeline-lane-id]").getBoundingClientRect().left
  );
}

async function click(x: number, y: number) {
  await mouse.move(x, y);
  await mouse.down();
  await mouse.up();
}

// A click on empty Layer 1 under `fraction` of the span seeks there.
async function seekInto(span: Element, fraction: number) {
  // A paste scrolls the timeline, which can leave the span under the sticky
  // layer labels, so scroll back first.
  query(".timeline-scroll").scrollLeft = 0;
  await settle();
  const spanBox = span.getBoundingClientRect();
  const laneBox = lane("1").getBoundingClientRect();
  const x = spanBox.x + spanBox.width * fraction;
  await click(x, laneBox.y + 20);
  // Anything left over the lane, such as a closing menu, would take the
  // click instead, so make sure the playhead landed there (#1001).
  await expect
    .poll(() => Math.abs(playheadX() - (x - laneBox.x)))
    .toBeLessThan(3);
}

beforeEach(async () => {
  await setViewport({ width: 1600, height: 1200 });
  await renderApp();
  await expect.element(page.elementLocator(lane("1"))).toBeVisible();
  await dropVideoIntoNewSourceTrack();
});

test("lists the layer clip items, then Copy to layer, with no Split hint", {
  timeout: TIMEOUT,
}, async () => {
  await openMenu(firstSpan());
  const menu = page.getByRole("menu").first();
  const labels = menu
    .getByRole("menuitem")
    .elements()
    .map((element) => element.textContent ?? "");
  expect(
    labels.map((label) => label.replace(/(Ctrl|Cmd|⌘).*|Del$/, "")),
  ).toEqual([
    "Jump to start",
    "Cut",
    "Copy",
    "Paste",
    "Duplicate",
    "Split at playhead",
    "Delete",
    "Copy to layer",
  ]);
  await expect
    .element(menuItem(/^Split at playhead/))
    .not.toMatchTextContent(/\+E/);
  await expect.element(menuItem(/^Cut/)).toMatchTextContent(/\+X/);
  await expect.element(menuItem(/^Duplicate/)).toMatchTextContent(/\+D/);
  // The playhead sits at the clip's start, so Split cannot apply.
  await expectDisabled(menuItem(/^Split at playhead/));
});

test("Jump to start moves the playhead to the source clip's start", {
  timeout: TIMEOUT,
}, async () => {
  const [{ left }] = layout();
  await seekInto(firstSpan(), 0.5);
  await expect.poll(playheadX).toBeGreaterThan(left + 40);

  await openMenu(firstSpan());
  await menuItem(/^Jump to start/).click();
  await expectSelected(firstSpan);
  await expect.poll(() => Math.abs(playheadX() - left)).toBeLessThan(3);
});

test("Split at playhead splits it, while Mod+E never does", {
  timeout: TIMEOUT,
}, async () => {
  const [{ left, width }] = layout();
  await seekInto(firstSpan(), 0.5);

  // Mod+E with only the source clip selected does nothing.
  await userEvent.click(firstSpan());
  await expectSelected(firstSpan);
  await pressMod("e");
  await settle();
  await expectCount(".source-span", 1);

  await openMenu(firstSpan());
  await menuItem(/^Split at playhead/).click();
  await expectCount(".source-span", 2);
  const pieces = layout();
  expect(pieces[0].left).toBeCloseTo(left, 0);
  expect(pieces[1].left).toBeCloseTo(left + width / 2, -1);
  expect(pieces[0].width + pieces[1].width).toBeCloseTo(width, -1);

  // Undo puts it back in one step.
  await pressMod("z");
  await expectCount(".source-span", 1);
});

test("the Edit menu offers no Split for a selected source clip", {
  timeout: TIMEOUT,
}, async () => {
  await seekInto(firstSpan(), 0.5);
  await userEvent.click(firstSpan());
  await expectSelected(firstSpan);
  await editMenu().click();
  await expect.element(menuItem(/^Copy(?! to)/)).toBeVisible();
  expect(menuItem(/^Clip:/).elements()).toHaveLength(0);
  expect(menuItem(/^Split at playhead/).elements()).toHaveLength(0);
});

test("Duplicate inserts a copy right after it; Delete removes it", {
  timeout: TIMEOUT,
}, async () => {
  const [{ left, width }] = layout();
  await openMenu(firstSpan());
  await menuItem(/^Duplicate/).click();
  await expectCount(".source-span", 2);
  const [first, copy] = layout();
  expect(first.left).toBeCloseTo(left, 0);
  expect(copy.left).toBeCloseTo(left + width, -1);

  await openMenu(lastSpan());
  await menuItem(/^Delete/).click();
  await expectCount(".source-span", 1);
});

test("Mod+D and Delete act on the selected source clip", {
  timeout: TIMEOUT,
}, async () => {
  await userEvent.click(firstSpan());
  await pressMod("d");
  await expectCount(".source-span", 2);
  // The copy is selected; Delete removes it.
  await expectSelected(lastSpan);
  await userEvent.keyboard("{Delete}");
  await expectCount(".source-span", 1);
});

// Source clips paste only into source tracks, and layer clips only onto
// layers (#958).
test("Copy pastes into the source track but not onto a layer", {
  timeout: TIMEOUT,
}, async () => {
  const [{ left, width }] = layout();
  await openMenu(firstSpan());
  await menuItem(/^Copy(?! to)/).click();

  // A layer's menu, and the Edit menu with a layer selected, gray Paste
  // out.
  lane("1").scrollIntoView({ block: "nearest", inline: "nearest" });
  await settle();
  await userEvent.click(lane("1"), {
    button: "right",
    position: { x: 400, y: 20 },
  });
  await expectDisabled(menuItem(/^Paste/));
  await userEvent.keyboard("{Escape}");
  await editMenu().click();
  await expectDisabled(menuItem(/^Paste/));
  await userEvent.keyboard("{Escape}");
  await expectCount(".clip-card", 0);

  // Into the source track at the playhead, overwriting the rest of the
  // clip.
  await seekInto(firstSpan(), 0.5);
  await openMenu(firstSpan());
  await menuItem(/^Paste/).click();
  await expectCount(".source-span", 2);
  const [kept, pasted] = layout();
  expect(kept.left).toBeCloseTo(left, 0);
  expect(kept.width).toBeCloseTo(width / 2, -1);
  expect(pasted.left).toBeCloseTo(left + width / 2, -1);
  expect(pasted.width).toBeCloseTo(width, -1);
});

test("a copied layer clip pastes onto a layer but not into the source track", {
  timeout: TIMEOUT,
}, async () => {
  await addLayers(1);
  await openMenu(firstSpan());
  await menuItem("Copy to layer").hover();
  await menuItem("Layer 1").click();
  const clips = () => queryAll('[data-timeline-lane-id="1"] .clip-card');
  await expect.poll(() => clips().length).toBe(1);
  await rightClick(clips()[0]);
  await menuItem(/^Copy/).click();

  // The source clip's menu grays Paste out, and Mod+V does nothing there.
  await openMenu(firstSpan());
  await expectDisabled(menuItem(/^Paste/));
  // Its menu left it selected.
  await userEvent.keyboard("{Escape}");
  await expectSelected(firstSpan);
  await pressMod("v");
  await expect
    .poll(() =>
      document
        .querySelector(".status-bar__message")
        ?.textContent?.replace(/\s+/g, " ")
        .trim(),
    )
    .toBe("Only source clips can be pasted into a source track.");
  await expectCount(".source-span", 1);
  await expectCount(".clip-card", 1);

  // A layer still takes it.
  lane("2").scrollIntoView({ block: "nearest", inline: "nearest" });
  await settle();
  await userEvent.click(lane("2"), {
    button: "right",
    position: { x: 400, y: 20 },
  });
  await menuItem(/^Paste/).click();
  await expectCount('[data-timeline-lane-id="2"] .clip-card', 1);
});

test("Cut removes it, and Paste puts it back into the source track", {
  timeout: TIMEOUT,
}, async () => {
  const [{ left }] = layout();
  await openMenu(firstSpan());
  await menuItem(/^Duplicate/).click();
  await expectCount(".source-span", 2);

  await openMenu(lastSpan());
  await menuItem(/^Cut/).click();
  await expectCount(".source-span", 1);

  // The playhead is at the start, so it pastes over the remaining clip.
  await openMenu(firstSpan());
  await menuItem(/^Paste/).click();
  await expectCount(".source-span", 1);
  await expectSelected(firstSpan);
  expect(layout()[0].left).toBeCloseTo(left, 0);
});

test("Mod+V pastes a copied source clip at the playhead, undone in one step", {
  timeout: TIMEOUT,
}, async () => {
  const [{ left, width }] = layout();
  await userEvent.click(firstSpan());
  await pressMod("c");

  // Past the clip, into empty space; seeking leaves the clip selected.
  await seekInto(firstSpan(), 1.5);
  await userEvent.click(firstSpan());
  await pressMod("v");
  await expectCount(".source-span", 2);
  const [kept, pasted] = layout();
  expect(kept).toEqual({ left, width });
  expect(pasted.left).toBeCloseTo(left + width * 1.5, -1);
  expect(pasted.width).toBeCloseTo(width, 0);
  await expectSelected(lastSpan);
  await expectCount(".clip-card", 0);

  await pressMod("z");
  await expectCount(".source-span", 1);
  expect(layout()).toEqual([{ left, width }]);
});

test("after Cut, Mod+V and Edit > Paste go back into the source track", {
  timeout: TIMEOUT,
}, async () => {
  const [{ left, width }] = layout();
  await userEvent.click(firstSpan());
  await pressMod("x");
  await expectCount(".source-span", 0);

  // The source track stays selected, so the paste lands there, not on a
  // layer.
  await pressMod("v");
  await expectCount(".source-span", 1);
  expect(layout()).toEqual([{ left, width }]);
  await expectSelected(firstSpan);
  await expectCount(".clip-card", 0);

  await pressMod("x");
  await expectCount(".source-span", 0);
  await editMenu().click();
  await menuItem(/^Paste/).click();
  await expectCount(".source-span", 1);
  expect(layout()).toEqual([{ left, width }]);
  await expectCount(".clip-card", 0);
});

test("locked source tracks disable the editing items", {
  timeout: TIMEOUT,
}, async () => {
  await userEvent.click(query(".source-header__lock"));
  await openMenu(firstSpan());
  for (const name of [
    /^Cut/,
    /^Paste/,
    /^Duplicate/,
    /^Split at playhead/,
    /^Delete/,
  ]) {
    const item = menuItem(name);
    await expectDisabled(item);
    await expect
      .element(item)
      .toHaveAttribute("title", "Source tracks are locked");
  }
  for (const name of [/^Jump to start/, /^Copy(?! to)/, /^Copy to layer/]) {
    await expect
      .element(menuItem(name))
      .not.toHaveAttribute("aria-disabled", "true");
  }

  // Their shortcuts leave the clip alone too.
  await userEvent.keyboard("{Escape}");
  await userEvent.click(firstSpan());
  await pressMod("d");
  await userEvent.keyboard("{Delete}");
  await settle();
  await expectCount(".source-span", 1);
});
