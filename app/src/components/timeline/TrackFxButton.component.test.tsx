import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
} from "../../component-test/editor.tsx";
import { insertFillAtStart } from "../../component-test/editor-steps.ts";
import {
  addLayers,
  layerHeader,
  move,
  undo,
} from "../../component-test/input.ts";
import { TrackFxButton } from "./TrackFxButton";

// The FX button in each layer header (#693): always toggleable, lit while
// the layer's FX are on, and turning it off turns off every effect on the
// layer, its clips' included. What that does to the preview stays in the
// layer-fx-toggle e2e spec.

function fxSwitch(id: string) {
  return layerHeader(id).querySelector(".track-label__fx") as HTMLButtonElement;
}

describe(TrackFxButton, { timeout: EDITOR_TEST_TIMEOUT }, () => {
  beforeEach(async () => {
    localStorage.clear();
    await renderEditor();
    await expect.poll(() => layerHeader("1")).toBeTruthy();
  }, 120_000);

  test("a layer without effects of its own has a lit FX button that turns its clips' FX off and on", async () => {
    const fx = () => fxSwitch("1");
    expect(fx().disabled).toBe(false);
    expect(fx().getAttribute("aria-pressed")).toBe("true");
    expect(fx().getAttribute("title")).toBe("Turn Layer 1 FX off");

    await insertFillAtStart("1");
    await page.getByRole("button", { name: "Add device to this clip" }).click();
    // The keyboard opens the submenu, so the pointer can't close it on its
    // way there.
    (
      page.getByRole("menuitem", { name: "Stylize" }).element() as HTMLElement
    ).focus();
    await userEvent.keyboard("{ArrowRight}");
    await page.getByRole("menuitem", { name: /^Negative Split/ }).click();
    const device = () =>
      document.querySelectorAll(
        `.fx-chain :is(section[data-fx-group="clip"], [data-fx-group="clip"] > section)[aria-label="Negative Split"]`,
      );
    await expect.poll(device).toHaveLength(1);
    expect(fx().getAttribute("aria-pressed")).toBe("true");

    await page.elementLocator(fx()).click();
    await expect.poll(() => fx().getAttribute("aria-pressed")).toBe("false");
    expect(fx().getAttribute("title")).toBe("Turn Layer 1 FX on");
    expect(layerHeader("1").textContent).toContain("FX off");
    await expect
      .poll(() => device()[0].className)
      .toMatch(/fx-device-panel--layer-off/);

    await page.elementLocator(fx()).click();
    await expect.poll(() => fx().getAttribute("aria-pressed")).toBe("true");
    await expect
      .poll(() => device()[0].className)
      .not.toMatch(/fx-device-panel--layer-off/);

    // Each toggle is one undo step.
    await undo();
    await expect.poll(() => fx().getAttribute("aria-pressed")).toBe("false");
    await undo();
    await expect.poll(() => fx().getAttribute("aria-pressed")).toBe("true");
  });

  test("every layer's FX button is enabled and lit by default", async () => {
    await addLayers();
    for (const id of ["1", "2", "3"]) {
      expect(fxSwitch(id).disabled).toBe(false);
      expect(fxSwitch(id).getAttribute("aria-pressed")).toBe("true");
    }
  });

  // The FX switch is plain text (#721): amber while on, muted while off,
  // with no chip, border or background either way.
  test("a layer's FX button is plain text, amber when on and muted when off", async () => {
    const fx = fxSwitch("1");
    await move(0, 0);
    expect(fx.getAttribute("aria-pressed")).toBe("true");
    const style = getComputedStyle(fx);
    expect(style.color).toBe("rgb(246, 183, 60)");
    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(style.borderTopWidth).toBe("0px");

    await page.elementLocator(fx).click();
    await move(0, 0);
    await expect.poll(() => fx.getAttribute("aria-pressed")).toBe("false");
    await expect.poll(() => style.color).toBe("rgb(164, 169, 191)");
    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(style.borderTopWidth).toBe("0px");
  });
});
