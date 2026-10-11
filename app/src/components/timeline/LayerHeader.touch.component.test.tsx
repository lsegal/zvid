import { describe, expect, test } from "vitest";
import { usePhone } from "../../component-test/viewport.ts";
import {
  addLayers,
  boxOf,
  centerOf,
  chooseFromMore,
  drag,
  findByRole,
  isVisible,
  moveFinger,
  PLAYWRIGHT_TEST_TIMEOUT,
  query,
  renderApp,
  timelineEdges,
  touch,
  waitAsLongAsPlaywright,
} from "../../mobile/phone-app-test-utils.tsx";
import { useLayerReorder } from "../../use-layer-reorder.ts";
import { LayerHeader } from "./LayerHeader";

// The phone's layer labels by touch (#1168, #1205): their edges resize the
// rows and the labels, and a long press or a grip reorders them. These
// mount the whole editor, since each drag edits the session; they get the
// e2e specs' time to run.

const names = () =>
  Array.from(
    document.querySelectorAll(
      "[data-layer-header-id] .track-label__select > span",
    ),
    (name) => name.textContent,
  );

const header = (id: string) => boxOf(`[data-layer-header-id="${id}"]`);

const isReordering = () =>
  query(".app-shell").classList.contains("app-shell--reordering");

waitAsLongAsPlaywright();

describe(`${LayerHeader.name} on a phone`, {
  timeout: PLAYWRIGHT_TEST_TIMEOUT,
}, () => {
  test("dragging a layer's bottom edge resizes its row", async () => {
    await usePhone();
    await renderApp();
    const before = header("1");
    // Below the name, inside the edge's finger-tall target.
    const from = { x: before.x + 60, y: before.y + before.height - 4 };
    await drag(from, { x: from.x, y: from.y + 40 });
    await expect
      .poll(() => header("1").height)
      .toBeGreaterThan(before.height + 30);
  });

  test("dragging the labels' right edge resizes them", async () => {
    await usePhone();
    await renderApp();
    const before = header("1");
    const rail = await findByRole("separator", "Resize track labels");
    expect(rail.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    const from = { x: before.x + before.width + 8, y: before.y + 20 };
    await drag(from, { x: from.x + 50, y: from.y });
    await expect
      .poll(() => header("1").width)
      .toBeGreaterThan(before.width + 40);
    // Time 0 follows the labels' edge (#1204).
    const edges = timelineEdges();
    expect(Math.abs(edges.lane - edges.labels)).toBeLessThanOrEqual(1);
    expect(Math.abs(edges.line - edges.labels)).toBeLessThan(4);
  });

  test("a long press on a layer's label picks it up to reorder", async () => {
    await usePhone();
    await renderApp();
    await addLayers(1);
    expect(names()).toEqual(["Layer 1", "Layer 2"]);
    // Outside Reorder Layers mode the long press stands in for the grips.
    expect(isVisible(document.querySelector(".track-label__grip"))).toBe(false);
    const first = centerOf('[data-layer-header-id="1"] .track-label__index');
    const second = header("2");
    await drag(first, { x: first.x, y: second.y + second.height - 8 }, 600);
    await expect.poll(names).toEqual(["Layer 2", "Layer 1"]);
  });
});

describe(`${useLayerReorder.name} on a phone`, {
  timeout: PLAYWRIGHT_TEST_TIMEOUT,
}, () => {
  // #1205: Reorder Layers mode shows the grips, which a finger drags at once.
  test("Reorder Layers mode drags layers by their grips", async () => {
    await usePhone();
    await renderApp();
    await addLayers(1);
    const grip = () =>
      document.querySelector('[data-layer-header-id="1"] .track-label__grip');
    expect(isVisible(grip())).toBe(false);

    await chooseFromMore("Reorder Layers");
    await expect.poll(isReordering).toBe(true);
    await expect.poll(() => isVisible(grip())).toBe(true);
    expect(getComputedStyle(grip() as Element).touchAction).toBe("none");
    expect(getComputedStyle(query(".track-label")).outlineStyle).toBe("dashed");
    const gripBox = (grip() as Element).getBoundingClientRect();
    expect(gripBox.width).toBeGreaterThanOrEqual(44);
    expect(gripBox.height).toBeGreaterThanOrEqual(44);

    // No long press: the drag starts as the finger moves.
    const scroller = query(".timeline-scroll");
    const scrollTop = scroller.scrollTop;
    const from = centerOf('[data-layer-header-id="1"] .track-label__grip');
    const second = header("2");
    await drag(from, { x: from.x, y: second.y + second.height - 8 });
    await expect.poll(names).toEqual(["Layer 2", "Layer 1"]);
    expect(scroller.scrollTop).toBe(scrollTop);

    await chooseFromMore("Done Reordering");
    await expect.poll(isReordering).toBe(false);
    await expect.poll(() => isVisible(grip())).toBe(false);
  });

  test("a grip dragged to the timeline's bottom edge scrolls past the visible rows", async () => {
    await usePhone();
    await renderApp();
    await addLayers(7);
    const headers = () =>
      Array.from(document.querySelectorAll("[data-layer-header-id]"));
    const scroller = query(".timeline-scroll");
    scroller.scrollTop = 0;
    await chooseFromMore("Reorder Layers");
    await expect.poll(isReordering).toBe(true);
    const last = headers().at(-1)?.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    if (!last) {
      throw new Error("The layers are not in the document");
    }
    // The last layer starts below the visible rows.
    expect(last.y).toBeGreaterThan(box.y + box.height);

    const from = centerOf('[data-layer-header-id="1"] .track-label__grip');
    const edge = { x: from.x, y: box.y + box.height - 4 };
    await touch("touchStart", [from]);
    await moveFinger(from, edge, 12);
    await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0);
    // Hold at the edge until the last layer has scrolled into view.
    await expect
      .poll(() => {
        const bottom = headers().at(-1)?.getBoundingClientRect();
        return (bottom?.y ?? Infinity) + (bottom?.height ?? 0);
      })
      .toBeLessThan(box.y + box.height);
    await touch("touchMove", [{ x: edge.x, y: edge.y - 1 }]);
    await touch("touchEnd", []);
    await expect.poll(() => names().at(-1)).toBe("Layer 1");
  });

  test("rows and labels still resize by touch in Reorder Layers mode", async () => {
    await usePhone();
    await renderApp();
    await chooseFromMore("Reorder Layers");
    await expect.poll(isReordering).toBe(true);
    const before = header("1");
    const edge = { x: before.x + 60, y: before.y + before.height - 4 };
    await drag(edge, { x: edge.x, y: edge.y + 40 });
    await expect
      .poll(() => header("1").height)
      .toBeGreaterThan(before.height + 30);

    const rail = { x: before.x + before.width + 8, y: before.y + 20 };
    await drag(rail, { x: rail.x + 50, y: rail.y });
    await expect
      .poll(() => header("1").width)
      .toBeGreaterThan(before.width + 40);
  });
});
