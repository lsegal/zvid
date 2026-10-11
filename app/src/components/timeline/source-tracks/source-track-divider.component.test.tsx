import { expect, test } from "vitest";
import {
  dispatchDrag,
  dropFiles,
  expectCount,
  fileTransfer,
  fixtureFile,
  query,
  queryAll,
  renderApp,
} from "../../../component-test/app.tsx";

// Source track labels draw the same right-edge divider as the layer and
// Audio rows, so the label column reads as one continuous vertical line, and
// the same bottom divider between rows, continuous with the row content's.

const header = '[aria-label="Source track drop area"]';
const tracks = '[data-source-track-drop-target="track"]';

async function videoTransfer() {
  return fileTransfer([await fixtureFile("test-pattern.mp4")]);
}

function border(element: Element, side: "Right" | "Bottom") {
  const style = getComputedStyle(element);
  return {
    width: style.getPropertyValue(`border-${side.toLowerCase()}-width`),
    style: style.getPropertyValue(`border-${side.toLowerCase()}-style`),
    color: style.getPropertyValue(`border-${side.toLowerCase()}-color`),
  };
}

function rightBorder(element: Element) {
  return border(element, "Right");
}

function bottomBorder(element: Element) {
  return border(element, "Bottom");
}

test("source track labels have the layer rows' right divider", async () => {
  await renderApp();
  const dataTransfer = await videoTransfer();
  await dropFiles(query(header), dataTransfer);
  await expectCount(tracks, 1, 30_000);

  const layer = rightBorder(query(".track-label--lane"));
  expect(layer.width).toBe("1px");
  expect(layer.style).toBe("solid");

  const source = query(`${tracks} .track-label--source`);
  expect(rightBorder(source)).toEqual(layer);

  await dispatchDrag(query(tracks), ["dragenter", "dragover"], dataTransfer);
  await expectCount(".track-label--source-drop", 1);
  const dropRow = query(".track-label--source-drop");
  await expect.element(dropRow).toBeVisible();
  expect(rightBorder(dropRow)).toEqual(layer);
}, 60_000);

test("source track labels have the layer rows' bottom divider", async () => {
  await renderApp();
  const dataTransfer = await videoTransfer();
  await dropFiles(query(header), dataTransfer);
  await expectCount(tracks, 1, 30_000);
  await dispatchDrag(query(tracks), ["dragenter", "dragover"], dataTransfer);
  await expectCount(".track-row--source-drop", 1);
  await dropFiles(query(".track-row--source-drop"), dataTransfer);
  await expectCount(tracks, 2, 30_000);

  const lane = query(".track-label--lane");
  const layer = bottomBorder(lane);
  expect(layer.width).toBe("1px");
  expect(layer.style).toBe("solid");
  const layerRight = rightBorder(lane);

  const labels = queryAll(`${tracks} .track-label--source`);
  for (const label of labels) {
    expect(bottomBorder(label)).toEqual(layer);
    expect(rightBorder(label)).toEqual(layerRight);
  }

  const first = query(tracks);
  const labelBox = first
    .querySelector(".track-label--source")
    ?.getBoundingClientRect();
  const contentBox = first
    .querySelector(".track-row__content--source")
    ?.getBoundingClientRect();
  expect(labelBox).toBeDefined();
  expect(contentBox).toBeDefined();
  expect(
    Math.abs(
      (labelBox?.y ?? 0) +
        (labelBox?.height ?? 0) -
        ((contentBox?.y ?? 0) + (contentBox?.height ?? 0)),
    ),
  ).toBeLessThan(0.5);
}, 90_000);
