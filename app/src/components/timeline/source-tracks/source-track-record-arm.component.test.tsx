import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import AppRoot from "../../../AppRoot.tsx";
import {
  MOD,
  mouse,
  query,
  queryAll,
  renderApp,
} from "../../../component-test/app.tsx";
import { setViewport } from "../../../component-test/viewport.ts";
import { installHarness } from "../../../harness";

// The record arm button on each source track handle (#854), right of its FX
// switch: clicking it arms or disarms the track, several tracks can be
// armed at once, and removing a track disarms it.

const rowSelector = ".track-row--source[data-source-track-id]";

function rows() {
  return queryAll(rowSelector);
}

function row(index: number) {
  const element = rows()[index];
  if (!element) {
    throw new Error(`missing source track row ${index}`);
  }
  return element;
}

function arm(index: number) {
  const button = row(index).querySelector<HTMLElement>(".track-label__arm");
  if (!button) {
    throw new Error(`missing arm button on row ${index}`);
  }
  return button;
}

// The arm button's aria-pressed on row `index`, read afresh each poll: undo
// re-renders the rows.
function expectPressed(index: number, pressed: "true" | "false") {
  return expect
    .poll(() => rows()[index]?.querySelector(".track-label__arm"))
    .toHaveAttribute("aria-pressed", pressed);
}

// The new-track row's [ + Track ] button, found afresh: each click adds a
// row above it.
function addTrack() {
  return page
    .elementLocator(query(".track-row--source-drop"))
    .getByRole("button", { name: "Track", exact: true })
    .element();
}

async function addTracks(count: number) {
  for (let index = 0; index < count; index++) {
    await userEvent.click(addTrack());
    await expect.poll(() => rows().length).toBe(index + 1);
  }
  await expect.poll(() => rows().length).toBe(count);
}

function trackName(index: number) {
  return (
    row(index).querySelector("[data-source-track-label-id] > span")
      ?.textContent ?? ""
  );
}

async function open() {
  await setViewport({ width: 1600, height: 1200 });
  return renderApp();
}

test("the arm button sits right of FX and toggles the track's armed state", async () => {
  await open();
  // The second track added is selected.
  await addTracks(2);
  const name = trackName(0);
  const label = row(0).querySelector(".track-label--source") as HTMLElement;
  const fx = label.querySelector(".track-label__fx") as HTMLElement;
  const button = arm(0);

  // Right after FX, the last control in the handle.
  const order = [...label.querySelectorAll("button")].map(
    (item) => item.className,
  );
  expect(order.at(-2)).toContain("track-label__fx");
  expect(order.at(-1)).toBe("track-label__arm");
  const fxBox = fx.getBoundingClientRect();
  const armBox = button.getBoundingClientRect();
  expect(armBox.x).toBeGreaterThan(fxBox.x + fxBox.width - 1);

  await mouse.move(0, 0);
  await expect.element(button).toHaveAttribute("aria-pressed", "false");
  await expect
    .element(button)
    .toHaveAccessibleName(`Arm ${name} for recording`);
  await expect
    .element(button)
    .toHaveAttribute("title", `Arm ${name} for recording`);
  const dot = button.querySelector(".track-label__arm-dot") as HTMLElement;
  await expect
    .poll(() => getComputedStyle(dot).backgroundColor)
    .toBe("rgba(0, 0, 0, 0)");

  await userEvent.click(button);
  await mouse.move(0, 0);
  await expect.element(button).toHaveAttribute("aria-pressed", "true");
  await expect.element(button).toHaveAccessibleName(`Disarm ${name}`);
  await expect.element(button).toHaveAttribute("title", `Disarm ${name}`);
  await expect
    .poll(() => getComputedStyle(dot).backgroundColor)
    .toBe("rgb(255, 92, 92)");
  // Arming leaves the selection alone.
  await expect
    .element(row(0).querySelector<HTMLElement>("[data-source-track-label-id]"))
    .not.toHaveAttribute("aria-current", "true");
  await expect
    .element(row(1).querySelector<HTMLElement>("[data-source-track-label-id]"))
    .toHaveAttribute("aria-current", "true");

  await userEvent.click(button);
  await expect.element(button).toHaveAttribute("aria-pressed", "false");
}, 60_000);

test("several tracks can be armed at once, and removing one disarms it", async () => {
  await open();
  await addTracks(3);
  await userEvent.click(arm(0));
  await userEvent.click(arm(2));
  await expectPressed(0, "true");
  await expectPressed(1, "false");
  await expectPressed(2, "true");

  // Deleting the first track disarms it: undo brings it back disarmed,
  // while the other armed track stays armed.
  await userEvent.click(
    row(0).querySelector(".track-label--source") as Element,
    {
      button: "right",
    },
  );
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect.poll(() => rows().length).toBe(2);
  await expectPressed(1, "true");
  await userEvent.keyboard(`{${MOD}>}z{/${MOD}}`);
  await expect.poll(() => rows().length).toBe(3);
  await expectPressed(0, "false");
  await expectPressed(2, "true");
}, 60_000);

test("the arm button fits a narrow handle without covering the track name", async () => {
  const screen = await open();
  // The stored label width applies on load: remount with it set.
  localStorage.setItem("zvid-label-width", "120");
  screen.unmount();
  await installHarness();
  await render(<AppRoot />);
  await expect
    .poll(() =>
      document.querySelector(".timeline-canvas.timeline-canvas--narrow-labels"),
    )
    .toBeTruthy();
  await expect
    .element(query(".timeline-canvas.timeline-canvas--narrow-labels"))
    .toBeVisible();
  await addTracks(1);
  const label = row(0).querySelector(".track-label--source") as HTMLElement;
  const name = label.querySelector("[data-source-track-label-id]");
  const fx = label.querySelector(".track-label__fx");
  const button = arm(0);
  if (!name || !fx) {
    throw new Error("The track handle is not visible");
  }
  const [labelBox, nameBox, fxBox, armBox] = [label, name, fx, button].map(
    (item) => item.getBoundingClientRect(),
  );
  expect(armBox.x + armBox.width).toBeLessThanOrEqual(
    labelBox.x + labelBox.width,
  );
  expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(fxBox.x);
  expect(fxBox.x + fxBox.width).toBeLessThanOrEqual(armBox.x + 1);
  expect(nameBox.width).toBeGreaterThan(16);
}, 60_000);
