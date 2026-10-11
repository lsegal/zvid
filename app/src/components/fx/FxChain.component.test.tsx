import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  emulateReducedMotion,
  nextFrames,
} from "../../component-test/fx-chain.ts";
import { FxEditor } from "../../component-test/fx-editor.tsx";
import { EMPTY_PROJECT, withEffect } from "../../component-test/fx-projects.ts";
import { centerOf, mouse } from "../../component-test/mouse.ts";
import { addableEffectsFor, groupAddableEffects } from "../../fx-chain.ts";

// The layer effects strip pans sideways by hand-grab dragging its
// background, or middle-dragging anywhere in it, without getting in the way
// of knobs or device reordering.

// The effects in the order the layer's Add FX menu lists them.
const LAYER_EFFECTS = groupAddableEffects(addableEffectsFor("layer")).flatMap(
  (group) => group.effects.map((definition) => definition.effectName),
);

const chainElement = () => {
  const chain = document.querySelector<HTMLElement>(".fx-chain");
  if (!chain) {
    throw new Error("No FX chain");
  }
  return chain;
};
const overflow = () => chainElement().scrollWidth - chainElement().clientWidth;

// Layer 1's chain with effects added, in menu order, until it overflows its
// panel by more than 250 px, at least three of them.
async function openLongChain() {
  let project = EMPTY_PROJECT;
  const screen = await render(<div />);
  for (let index = 0; ; index += 1) {
    if (index >= LAYER_EFFECTS.length) {
      throw new Error("Every effect fits in the FX chain without panning");
    }
    project = withEffect(project, "1", LAYER_EFFECTS[index]).project;
    await screen.rerender(
      <FxEditor key={index} project={project} selection={{ laneId: "1" }} />,
    );
    await nextFrames();
    if (index >= 2 && overflow() > 250) {
      break;
    }
  }
  await expect.poll(overflow).toBeGreaterThan(250);
  chainElement().scrollIntoView({ block: "nearest" });
  return chainElement();
}

async function drag(
  from: { x: number; y: number },
  dx: number,
  button: "left" | "middle" = "left",
) {
  await mouse.move(from.x, from.y);
  await mouse.down({ button });
  await mouse.move(from.x + dx, from.y, { steps: 8 });
  await mouse.up({ button });
}

// A point in the chain's top padding, above the devices: background.
function backgroundPoint(chain: HTMLElement) {
  const box = chain.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + 5 };
}

describe("FX chain drag scrolling", { timeout: 60_000 }, () => {
  // Without momentum, the scroll lands exactly where the pointer left it.
  beforeEach(() => emulateReducedMotion());
  afterEach(() => emulateReducedMotion(false));

  test("dragging the strip's background pans it with a hand cursor", async () => {
    const chain = await openLongChain();
    expect(getComputedStyle(chain).cursor).toBe("grab");

    const start = backgroundPoint(chain);
    await mouse.move(start.x, start.y);
    await mouse.down();
    await mouse.move(start.x - 100, start.y, { steps: 4 });
    await expect
      .element(page.elementLocator(chain))
      .toHaveClass(/fx-chain--grab-scrolling/);
    expect(getComputedStyle(chain).cursor).toBe("grabbing");
    await mouse.move(start.x - 200, start.y, { steps: 4 });
    await mouse.up();

    await expect
      .element(page.elementLocator(chain))
      .not.toHaveClass(/fx-chain--grab-scrolling/);
    expect(chain.scrollLeft).toBe(200);

    // And back again.
    await drag(start, 150);
    expect(chain.scrollLeft).toBe(50);
  });

  test("a press below the drag threshold does not pan", async () => {
    const chain = await openLongChain();
    await drag(backgroundPoint(chain), -3);
    expect(chain.scrollLeft).toBe(0);
  });

  test("dragging a knob adjusts it rather than panning", async () => {
    const chain = await openLongChain();
    const knob = chain.querySelector('[role="slider"]');
    if (!knob) {
      throw new Error("No knob in the FX chain");
    }
    await drag(centerOf(knob), -150);
    expect(chain.scrollLeft).toBe(0);
  });

  test("dragging a device title bar still reorders devices", async () => {
    const chain = await openLongChain();
    const panels = () => [
      ...chain.querySelectorAll<HTMLElement>(".fx-device-panel"),
    ];
    const names = () =>
      panels().map((element) => element.getAttribute("aria-label"));
    const before = names();

    const title = panels()[1].querySelector(".fx-device-panel__title");
    // The target with its attached Animation section, when it has one.
    const target = panels()[2].closest("[data-fx-group]");
    if (!title || !target) {
      throw new Error("FX devices are not visible");
    }

    // The target can run past the chain's right edge. Dropping out there
    // would auto-scroll the chain for as long as the drag lasts, so the
    // slot it lands in would depend on timing. Scroll the target clear of
    // the auto-scroll zone first.
    const chainBox = chain.getBoundingClientRect();
    const unscrolledTargetBox = target.getBoundingClientRect();
    const autoScrollZone = 48;
    const targetOverflow =
      unscrolledTargetBox.right - (chainBox.right - 2 * autoScrollZone);
    if (targetOverflow > 0) {
      chain.scrollLeft = Math.ceil(targetOverflow);
    }

    const titleBox = title.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    expect(titleBox.left).toBeGreaterThan(chainBox.left + autoScrollZone);
    expect(targetBox.right).toBeLessThan(chainBox.right - autoScrollZone);
    const titleCenter = centerOf(title);
    await drag(titleCenter, targetBox.right - 4 - titleCenter.x);

    await expect.poll(names).not.toEqual(before);
    const after = names();
    expect(after[2]).toBe(before[1]);
    expect(after[1]).toBe(before[2]);
  });

  test("middle-dragging over a device pans the strip", async () => {
    const chain = await openLongChain();
    const body = chain.querySelector(".fx-device-panel__body");
    if (!body) {
      throw new Error("No device body in the FX chain");
    }
    await drag(centerOf(body), -120, "middle");
    expect(chain.scrollLeft).toBe(120);
  });
});
