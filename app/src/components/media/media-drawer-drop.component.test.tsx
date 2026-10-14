import { expect, test } from "vitest";
import { page } from "vitest/browser";
import {
  dispatchDrag,
  dropFiles,
  expectCount,
  fileTransfer,
  fixtureFile,
  query,
  renderApp,
} from "../../component-test/app.tsx";

// Dropping media files from the OS on the Media drawer links their media
// without making clips, and a drag left of the timeline, where the closed
// drawer sits, springs the drawer open on its Media tab.

const drawer = "#media-drawer";
const openColumn = ".media-drawer-column.is-open";
const dropHighlight = ".media-drawer-column.is-drop-target";
const binItems = `${drawer} [role="option"]`;

const video = () => fixtureFile("test-pattern.mp4");
const audio = () => fixtureFile("tone.wav");

async function openMediaTab() {
  await page.getByRole("button", { name: "Media", exact: true }).click();
  await expectCount(openColumn, 1);
}

test("dropping media files on the Media drawer imports them without clips", async () => {
  await renderApp();
  await openMediaTab();

  const transfer = fileTransfer([await video(), await audio()]);
  await dispatchDrag(query(drawer), ["dragenter", "dragover"], transfer);
  await expectCount(dropHighlight, 1);
  await dropFiles(query(drawer), transfer);

  await expectCount(dropHighlight, 0);
  await expectCount(binItems, 2, 30_000);
  await expect.element(page.getByText("Imported 2 media files.")).toBeVisible();
  await expectCount(".source-span", 0);
  await expectCount("[data-source-track-drop-target='track']", 0);
}, 60_000);

test("dragging media to the timeline's left edge opens the Media drawer", async () => {
  await renderApp();
  await expectCount(openColumn, 0);

  const timeline = query(".timeline-scroll").getBoundingClientRect();
  const point = {
    clientX: timeline.left + 4,
    clientY: timeline.top + timeline.height / 2,
  };
  const transfer = fileTransfer([await video()]);
  await dispatchDrag(
    document.elementFromPoint(point.clientX, point.clientY) as Element,
    ["dragenter", "dragover"],
    transfer,
    point,
  );
  await expectCount(openColumn, 1);
  await expect
    .element(page.getByRole("complementary", { name: "Media" }))
    .toBeVisible();

  // The drag goes on to the drawer it opened and drops there.
  await dropFiles(query(drawer), transfer);
  await expectCount(binItems, 1, 30_000);
  await expectCount(".source-span", 0);
}, 60_000);

test("a non-media file is not taken by the Media drawer", async () => {
  await renderApp();
  await openMediaTab();

  const transfer = fileTransfer([
    new File(["notes"], "notes.txt", { type: "text/plain" }),
  ]);
  await dispatchDrag(query(drawer), ["dragenter", "dragover"], transfer);
  await expectCount(dropHighlight, 0);
  await dropFiles(query(drawer), transfer);

  await expect
    .element(
      page.getByText(
        "Only audio, video and image files can be dropped on the Media drawer.",
      ),
    )
    .toBeVisible();
  await expectCount(binItems, 0);
});

test("a non-media file drag left of the timeline leaves the drawer closed", async () => {
  await renderApp();

  const timeline = query(".timeline-scroll").getBoundingClientRect();
  const point = {
    clientX: timeline.left + 4,
    clientY: timeline.top + timeline.height / 2,
  };
  await dispatchDrag(
    document.elementFromPoint(point.clientX, point.clientY) as Element,
    ["dragenter", "dragover"],
    fileTransfer([new File(["notes"], "notes.txt", { type: "text/plain" })]),
    point,
  );
  await expectCount(openColumn, 0);
});
