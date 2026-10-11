import { beforeEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
  withTestPatternTrack,
} from "../../component-test/editor.tsx";
import { insertFillAtStart } from "../../component-test/editor-steps.ts";
import { layerHeader, undo } from "../../component-test/input.ts";
import { TrackHideButton } from "./TrackHideButton";

// The Hide switch on each layer and source track header (#1026), left of
// its FX switch. What hiding does to the preview stays in the track-hide
// e2e spec, and how the compositor treats a hidden layer is in
// CompositionPlayer.hidden-layers.component.test.tsx.

describe(TrackHideButton, { timeout: EDITOR_TEST_TIMEOUT }, () => {
  beforeEach(() => {
    localStorage.clear();
  }, 120_000);

  test("the eye left of a layer's FX switch hides it, undoably", async () => {
    await renderEditor();
    await expect.poll(() => layerHeader("1")).toBeTruthy();
    await insertFillAtStart("1");

    const eye = () =>
      layerHeader("1").querySelector(".track-label__hide") as HTMLElement;
    const pressed = () => eye().getAttribute("aria-pressed");
    expect(pressed()).toBe("false");
    expect(eye().getAttribute("title")).toBe("Hide Layer 1");
    // It sits just left of the FX switch.
    const fx = layerHeader("1").querySelector(
      ".track-label__fx",
    ) as HTMLElement;
    const eyeBox = eye().getBoundingClientRect();
    expect(eyeBox.x + eyeBox.width).toBeLessThanOrEqual(
      fx.getBoundingClientRect().x + 1,
    );

    await page.elementLocator(eye()).click();
    await expect.poll(pressed).toBe("true");
    expect(eye().getAttribute("title")).toBe("Show Layer 1");
    expect(layerHeader("1").textContent).toContain("Hidden");
    // Clicking the eye doesn't select the layer instead of the clip.
    expect(
      (
        document.querySelector(
          '[data-timeline-lane-id="1"] .clip-card--fill',
        ) as HTMLElement
      ).className,
    ).toMatch(/clip-card--selected/);

    await page.elementLocator(eye()).click();
    await expect.poll(pressed).toBe("false");
    expect(layerHeader("1").textContent).not.toContain("Hidden");

    // Each toggle is one undo step.
    await undo();
    await expect.poll(pressed).toBe("true");
    await undo();
    await expect.poll(pressed).toBe("false");
  });

  test("a source track's eye hides it", async () => {
    await renderEditor({ project: withTestPatternTrack() });
    await expect
      .poll(() => document.querySelector(".track-label--source"))
      .toBeTruthy();
    const label = document.querySelector(".track-label--source") as HTMLElement;
    const eye = () => label.querySelector(".track-label__hide") as HTMLElement;
    expect(eye().getAttribute("aria-pressed")).toBe("false");

    await page.elementLocator(eye()).click();
    await expect.poll(() => eye().getAttribute("aria-pressed")).toBe("true");
    expect(eye().getAttribute("title")).toBe("Show test-pattern");
    expect(label.textContent).toContain("Hidden");

    await page.elementLocator(eye()).click();
    await expect.poll(() => eye().getAttribute("aria-pressed")).toBe("false");
    expect(label.textContent).not.toContain("Hidden");
  });
});
