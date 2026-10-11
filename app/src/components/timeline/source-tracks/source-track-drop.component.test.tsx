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
} from "../../../component-test/app.tsx";

// Dropping audio and video files from the OS onto the source tracks: onto a
// track adds them to it, and onto the header or the new-track row (the
// [ + Track ] placeholder) creates a track.

const header = '[aria-label="Source track drop area"]';
const tracks = '[data-source-track-drop-target="track"]';
const newTrackRow = ".track-row--source-drop";
// The new-track row while it takes a drag, rather than showing [ + Track ].
const newTrackDropRow = ".track-placeholder--drag";

const video = () => fixtureFile("test-pattern.mp4");
const audio = () => fixtureFile("tone.wav");

async function dropIntoNewTrack(files: File[]) {
  await dropFiles(query(header), fileTransfer(files));
  await expectCount(tracks, 1);
  await expectCount(".source-span", files.length, 30_000);
}

test("dropping on an existing track's label adds to that track", async () => {
  await renderApp();
  await dropIntoNewTrack([await video()]);

  await dropFiles(
    query(`${tracks} .track-label--source`),
    fileTransfer([await audio()]),
  );

  await expectCount(".source-span", 2, 30_000);
  await expectCount(tracks, 1);
  await expectCount(newTrackDropRow, 0);
}, 60_000);

test("dropping on a track's clips adds to that track", async () => {
  await renderApp();
  await dropIntoNewTrack([await video()]);

  await dropFiles(
    query(`${tracks} .source-span`),
    fileTransfer([await audio()]),
  );

  await expectCount(".source-span", 2, 30_000);
  await expectCount(tracks, 1);
}, 60_000);

test("dropping on the new-track row creates a track", async () => {
  await renderApp();
  await dropIntoNewTrack([await video()]);

  const transfer = fileTransfer([await audio()]);
  await dispatchDrag(query(tracks), ["dragenter", "dragover"], transfer);
  await expectCount(newTrackDropRow, 1);
  await expect.element(query(newTrackDropRow)).toBeVisible();
  await expectCount(`${tracks} .is-drop-target`, 1);
  await dropFiles(query(newTrackRow), transfer);

  await expectCount(tracks, 2, 30_000);
  await expectCount(".source-span", 2, 30_000);
  await expectCount(newTrackDropRow, 0);
}, 60_000);

test("dropping two files imports both into one track", async () => {
  await renderApp();
  await dropIntoNewTrack([await video(), await audio()]);

  await expectCount(tracks, 1);
}, 60_000);

test("dropping a non-media file changes nothing", async () => {
  await renderApp();
  await dropFiles(
    query(header),
    fileTransfer([new File(["notes"], "notes.txt", { type: "text/plain" })]),
  );

  await expect
    .element(
      page.getByText(
        "Only audio and video files can be dropped on source tracks.",
      ),
    )
    .toBeVisible();
  await expectCount(tracks, 0);
  await expectCount(".source-span", 0);
});
