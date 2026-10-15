import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderApp } from "../component-test/app.tsx";
import { EDITOR_TEST_TIMEOUT } from "../component-test/editor.tsx";
import { LAYERS_COLLAPSED_STORAGE_KEY } from "../layers-section.ts";

// The MIDI sample opens at 90% zoom with the Layers section collapsed
// (#1467); the Default sample leaves both as they are.

function layersToggle() {
  return document.querySelector(".ruler-row__layers-toggle") as HTMLElement;
}

async function openSample(name: string) {
  await userEvent.click(page.getByRole("menuitem", { name: "File", exact: true }));
  await userEvent.click(page.getByRole("menuitem", { name: "Open", exact: true }));
  await userEvent.click(
    page.getByRole("menuitem", { name: "Samples", exact: true }),
  );
  await userEvent.click(page.getByRole("menuitem", { name, exact: true }));
}

test("the MIDI sample opens at 90% zoom with the Layers section collapsed", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  await renderApp();
  expect(layersToggle().title).toBe("Hide layers");

  await openSample("MIDI");
  await expect
    .element(page.getByRole("button", { name: "Zoom 90%, reset to 100%" }))
    .toBeVisible();
  await expect.poll(() => layersToggle().title).toBe("Show layers");
  expect(document.querySelector(".layers-header")).not.toBeNull();
  expect(localStorage.getItem(LAYERS_COLLAPSED_STORAGE_KEY)).toBe("true");
});

test("the Default sample keeps 100% zoom and the Layers section shown", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  await renderApp();

  await openSample("Default");
  await expect
    .element(page.getByText("zvid opening sample", { exact: true }).first())
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Zoom 100%, reset to 100%" }))
    .toBeVisible();
  expect(layersToggle().title).toBe("Hide layers");
  expect(document.querySelector(".layers-header")).toBeNull();
});
