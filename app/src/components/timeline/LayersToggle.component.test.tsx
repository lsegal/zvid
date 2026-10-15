import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
  sessionWithLayers,
} from "../../component-test/editor.tsx";
import { LAYERS_COLLAPSED_STORAGE_KEY } from "../../layers-section.ts";

// The layers toggle in the ruler's label shows and hides the Layers area
// (#1453). Hidden, the layers give way to a collapsed Layers header like the
// collapsed Source Tracks one, whose expander shows them again.

function layerRows() {
  return document.querySelectorAll("[data-layer-row-id]").length;
}

function toggle() {
  return document.querySelector(".ruler-row__layers-toggle") as HTMLElement;
}

function collapsedHeader() {
  return document.querySelector(".layers-header");
}

test("the layers toggle and the collapsed header's expander show and hide the layers", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  await renderEditor({ project: sessionWithLayers(3) });
  await expect.poll(layerRows).toBe(3);

  // Shown: the toggle is at full opacity and there's no collapsed header.
  expect(toggle().getAttribute("aria-pressed")).toBe("true");
  expect(toggle().title).toBe("Hide layers");
  expect(getComputedStyle(toggle()).opacity).toBe("1");
  expect(collapsedHeader()).toBeNull();
  // It sits at the right of the ruler's label cell.
  const label = toggle().closest(".track-label") as HTMLElement;
  expect(
    label.getBoundingClientRect().right -
      toggle().getBoundingClientRect().right,
  ).toBeLessThanOrEqual(20);

  await userEvent.click(toggle());
  await expect.poll(layerRows).toBe(0);
  expect(toggle().getAttribute("aria-pressed")).toBe("false");
  expect(toggle().title).toBe("Show layers");
  expect(Number(getComputedStyle(toggle()).opacity)).toBeLessThan(0.5);
  expect(collapsedHeader()?.textContent).toContain("Layers");
  expect(collapsedHeader()?.textContent).toContain("3 layers in session");
  expect(collapsedHeader()?.textContent).toContain("3 layers hidden");
  expect(
    page.getByRole("button", { name: "Layer", exact: true }).elements(),
  ).toHaveLength(0);
  expect(localStorage.getItem(LAYERS_COLLAPSED_STORAGE_KEY)).toBe("true");

  await userEvent.click(toggle());
  await expect.poll(layerRows).toBe(3);
  expect(toggle().getAttribute("aria-pressed")).toBe("true");
  expect(collapsedHeader()).toBeNull();

  // The expander does what the toggle does, and the toggle follows it.
  await userEvent.click(toggle());
  await expect.poll(collapsedHeader).not.toBeNull();
  const expander = page.elementLocator(
    document.querySelector(".layers-header__toggle") as HTMLElement,
  );
  await expect.element(expander).toHaveAttribute("aria-expanded", "false");
  await expander.click();
  await expect.poll(layerRows).toBe(3);
  expect(collapsedHeader()).toBeNull();
  expect(toggle().getAttribute("aria-pressed")).toBe("true");
  expect(getComputedStyle(toggle()).opacity).toBe("1");
  expect(localStorage.getItem(LAYERS_COLLAPSED_STORAGE_KEY)).toBe("false");
});
