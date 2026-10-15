import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  dropFiles,
  expectCount,
  fileTransfer,
  fixtureFile,
  mouse,
  query,
  queryAll,
  renderApp,
} from "../../../component-test/app.tsx";

// Source tracks and source clips are selected like layers and clips, and
// only one thing in the timeline is selected at a time.

const SOURCE_ROW = '[data-source-track-drop-target="track"]';
const LAYER_CLIPS = '[data-timeline-lane-id="1"] .clip-card';

function classes(selector: string) {
  return () => [...query(selector).classList];
}

async function expectNoLayerSelected() {
  await expectCount(".arrangement-lanes .track-row--selected", 0);
  await expectCount(".clip-card--selected", 0);
}

beforeEach(async () => {
  await renderApp();
  await dropFiles(
    query('[data-source-track-drop-target="new-track"]'),
    fileTransfer([await fixtureFile("test-pattern.mp4")]),
  );
  await expectCount(".source-span", 1);
}, 60_000);

test("selects source tracks and source clips instead of layers and clips", async () => {
  const labelName = () =>
    page.elementLocator(query(".track-label--source .track-label__select"));
  const span = () => query(".source-span");
  const clipBody = () => query(`${LAYER_CLIPS} .clip-card__body`);

  // Put a clip on Layer 1, which selects it.
  await userEvent.click(span(), { button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: "Layer 1" }).click();
  await expectCount(LAYER_CLIPS, 1);
  query(LAYER_CLIPS).scrollIntoView({ block: "center" });
  await expect.poll(classes(LAYER_CLIPS)).toContain("clip-card--selected");
  await expect
    .poll(classes(".source-span"))
    .not.toContain("source-span--selected");

  // The source track's label selects the track, and no layer or clip.
  await userEvent.click(query(".track-label--source"));
  await expect.poll(classes(SOURCE_ROW)).toContain("track-row--selected");
  await expect.element(labelName()).toHaveAttribute("aria-current", "true");
  await expect
    .poll(classes(".source-span"))
    .not.toContain("source-span--selected");
  await expectNoLayerSelected();
  // The FX panel shows the source track's own stack, not a layer's.
  await expect
    .poll(() =>
      queryAll(".fx-chain [data-fx-divider]").map((element) =>
        element.textContent?.trim(),
      ),
    )
    .toEqual(["Global", "Track"]);
  await expect
    .element(page.getByText("Select a layer to see its effects"))
    .not.toBeInTheDocument();

  // A source clip selects the clip and makes its track the active one.
  await userEvent.click(span());
  await expect.poll(classes(".source-span")).toContain("source-span--selected");
  await expect.poll(classes(SOURCE_ROW)).toContain("track-row--selected");
  await expectNoLayerSelected();

  // Empty space in the row clears the source clip, keeping its track.
  const spanBox = span().getBoundingClientRect();
  const rowBox = query(
    `${SOURCE_ROW} .track-row__content--source`,
  ).getBoundingClientRect();
  await mouse.move(spanBox.right + 40, rowBox.top + rowBox.height / 2);
  await mouse.down();
  await mouse.up();
  await expect
    .poll(classes(".source-span"))
    .not.toContain("source-span--selected");
  await expect.poll(classes(SOURCE_ROW)).toContain("track-row--selected");

  // Selecting an arrangement clip clears the source selection.
  await userEvent.click(span());
  await expect.poll(classes(".source-span")).toContain("source-span--selected");
  await userEvent.click(clipBody());
  await expect.poll(classes(LAYER_CLIPS)).toContain("clip-card--selected");
  await expect
    .poll(classes(".source-span"))
    .not.toContain("source-span--selected");
  await expect.poll(classes(SOURCE_ROW)).not.toContain("track-row--selected");
  await expect.element(labelName()).not.toHaveAttribute("aria-current", "true");
}, 60_000);

test("Ctrl/Cmd-click on a source clip still adds it to the arrangement", async () => {
  // Cmd on macOS, Ctrl elsewhere, as Playwright's ControlOrMeta.
  await userEvent.click(query(".source-span"), {
    modifiers: ["ControlOrMeta"],
  });
  await expectCount(".clip-card", 1);
  await expect.poll(classes(".clip-card")).toContain("clip-card--selected");
  await expect
    .poll(classes(".source-span"))
    .not.toContain("source-span--selected");
}, 60_000);

test("right-clicking a source clip selects it and opens its menu", async () => {
  await userEvent.click(query(".source-span"), { button: "right" });
  await expect
    .element(page.getByRole("menuitem", { name: "Copy to layer" }))
    .toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.poll(classes(".source-span")).toContain("source-span--selected");
  await expectNoLayerSelected();
}, 60_000);
