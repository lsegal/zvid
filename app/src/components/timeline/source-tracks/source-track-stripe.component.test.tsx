import { expect, test } from "vitest";
import {
  dispatchDrag,
  expectCount,
  fileTransfer,
  fixtureFile,
  query,
  renderApp,
} from "../../../component-test/app.tsx";

// A source track's color stripe is square and flush with its label's left
// edge, spanning the row's full height, on track rows and the new-track row.

const tracks = '[data-source-track-drop-target="track"]';

function expectFlushStripe(row: Element) {
  const label = row.querySelector(".track-label");
  const stripe = label?.querySelector(".track-label__stripe");
  if (!label || !stripe) throw new Error("missing label or stripe");
  const rowBox = row.getBoundingClientRect();
  const labelBox = label.getBoundingClientRect();
  const stripeBox = stripe.getBoundingClientRect();
  expect(stripeBox.left).toBe(labelBox.left);
  expect(stripeBox.top).toBe(rowBox.top);
  expect(stripeBox.bottom).toBe(rowBox.bottom);
  expect(stripeBox.width).toBe(4);
  expect(getComputedStyle(stripe).borderRadius).toBe("0px");
}

test("source track stripes are flush, square and full height", async () => {
  await renderApp();
  const transfer = fileTransfer([await fixtureFile("test-pattern.mp4")]);
  await dispatchDrag(
    query('[aria-label="Source track drop area"]'),
    ["dragenter", "dragover", "drop"],
    transfer,
  );
  await expectCount(tracks, 1);
  expectFlushStripe(query(".track-row--source"));

  await dispatchDrag(query(tracks), ["dragenter", "dragover"], transfer);
  await expectCount(".track-row--source-drop.track-placeholder--drag", 1);
  const dropRow = query(".track-row--source-drop");
  await expect.element(dropRow).toBeVisible();
  expectFlushStripe(dropRow);
});
