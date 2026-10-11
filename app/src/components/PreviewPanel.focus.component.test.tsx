/// <reference types="@vitest/browser-playwright" />
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { center, drag, nextFrames, touch } from "../component-test/input.ts";
import {
  PHONE_LANDSCAPE_VIEWPORT,
  usePhone,
} from "../component-test/viewport.ts";
import { resolveCanvasBounds } from "../composition-layout.ts";
import { IDENTITY_TRANSFORM } from "../composition-transform.ts";
import { type PreviewLayer, resolvePreviewEditFrame } from "../preview-edit.ts";
import { PhoneEditor } from "./mobile/phone-editor.fixture.tsx";
import { PreviewPanel } from "./PreviewPanel";
import type {
  PreviewLayerMove,
  PreviewLayerTransformEdit,
} from "./PreviewTransformOverlay";

// The portrait phone preview takes a tap before its layers move, so a swipe
// that starts on it doesn't grab a layer (#1257). Phone landscape, tablets
// and desktop drag layers straight away.
const CANVAS = { width: 1920, height: 1080 };
const LAYER = (() => {
  const layer = {
    laneId: "1",
    clipId: "clip-1",
    placement: { frame: resolveCanvasBounds(CANVAS.width, CANVAS.height) },
    transform: IDENTITY_TRANSFORM,
    clipTransform: IDENTITY_TRANSFORM,
  };
  return {
    ...layer,
    corners: resolvePreviewEditFrame(layer, false, CANVAS).corners,
  } satisfies PreviewLayer;
})();

type Point = { x: number; y: number };

// A point on the layer, clear of the origin marker at its center.
function onLayer(): Point {
  const { x, y } = center(overlay());
  return { x: x - 60, y: y - 40 };
}

async function renderPreview() {
  const moves: PreviewLayerMove[] = [];
  const transforms: PreviewLayerTransformEdit[] = [];
  await render(
    <PhoneEditor
      preview={{
        previewLayers: [LAYER],
        resolvePreviewLayersAt: () => [LAYER],
        previewLaneId: "1",
        movePreviewLayer: (move) => moves.push(move),
        transformPreviewLayer: (edit) => transforms.push(edit),
      }}
    />,
  );
  await expect.element(overlay()).toBeVisible();
  await nextFrames();
  return { moves, transforms };
}

const overlay = () =>
  document.querySelector<HTMLElement>(
    '[data-testid="preview-transform-overlay"]',
  ) as HTMLElement;
const shield = () =>
  document.querySelector('[data-testid="preview-focus-shield"]');

async function touchDrag(from: Point, to: Point, steps = 10) {
  await touch("touchStart", from.x, from.y);
  for (let step = 1; step <= steps; step += 1) {
    await touch(
      "touchMove",
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps,
    );
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  await touch("touchEnd", to.x, to.y);
  await nextFrames();
}

async function tap({ x, y }: Point) {
  await touch("touchStart", x, y);
  await touch("touchEnd", x, y);
  await nextFrames();
}

// A resize handle inside the monitor, which clips the ones past its edge.
function resizeHandle() {
  const bounds = overlay().getBoundingClientRect();
  const handle = [
    ...document.querySelectorAll<HTMLElement>("[data-transform-handle]"),
  ].find((element) => {
    const { x, y } = center(element);
    return (
      x > bounds.left && x < bounds.right && y > bounds.top && y < bounds.bottom
    );
  });
  if (!handle) {
    throw new Error("no resize handle inside the monitor");
  }
  return handle;
}

describe(PreviewPanel.name, () => {
  test("a swipe on the unfocused portrait preview moves nothing", async () => {
    await usePhone();
    const { moves } = await renderPreview();
    expect(shield()).not.toBeNull();

    const from = onLayer();
    await touchDrag(from, { x: from.x, y: from.y + 80 });

    expect(moves).toEqual([]);
    expect(shield()).not.toBeNull();
  });

  test("a tap focuses the portrait preview, then drags move and resize", async () => {
    await usePhone();
    const { moves, transforms } = await renderPreview();

    const from = onLayer();
    await tap(from);
    expect(shield()).toBeNull();
    expect(moves).toEqual([]);
    expect(document.querySelector(".preview-monitor--focused")).not.toBeNull();

    await touchDrag(from, { x: from.x + 40, y: from.y + 30 });
    expect(moves.at(-1)).toMatchObject({ laneId: "1", mode: "commit" });

    const handleFrom = center(resizeHandle());
    const toward = center(overlay());
    await touchDrag(handleFrom, {
      x: handleFrom.x + Math.sign(toward.x - handleFrom.x) * 20,
      y: handleFrom.y + Math.sign(toward.y - handleFrom.y) * 20,
    });
    expect(transforms.at(-1)).toMatchObject({
      kind: "resize",
      mode: "commit",
    });
  });

  test("a press outside the portrait preview unfocuses it", async () => {
    await usePhone();
    await renderPreview();

    await tap(onLayer());
    expect(shield()).toBeNull();

    const tabs = document.querySelector(".preview-panel__header") as Element;
    await tap(center(tabs));
    expect(shield()).not.toBeNull();
  });

  test("phone landscape drags layers without a focus tap", async () => {
    await usePhone(PHONE_LANDSCAPE_VIEWPORT);
    const { moves } = await renderPreview();
    expect(shield()).toBeNull();

    const from = onLayer();
    await touchDrag(from, { x: from.x + 40, y: from.y + 30 });
    expect(moves.at(-1)).toMatchObject({ laneId: "1", mode: "commit" });
  });

  test("desktop drags layers without a focus tap", async () => {
    const { moves } = await renderPreview();
    expect(shield()).toBeNull();

    const from = onLayer();
    await drag(from, { x: from.x + 40, y: from.y + 30 });
    expect(moves.at(-1)).toMatchObject({ laneId: "1", mode: "commit" });
  });
});
