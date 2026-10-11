import { beforeEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { TrackRecordDevice } from "./TrackRecordDevice";
import {
  projectWithMedia,
  TimelineHarness,
  testPatternVideo,
} from "./timeline/timeline-harness";

// Selecting a source track, or one of its clips, leads the Effects pane
// with a Record device, ahead of the Clip device and the Global section:
// collapsed by default, expanded while the track is armed. Its Video and
// Audio inputs and live previews need a camera and microphone, so they stay
// in the track-record-device e2e spec, on Chromium's fake devices.

function query(selector: string) {
  return document.querySelector(selector) as HTMLElement;
}

function left(element: Element) {
  return element.getBoundingClientRect().x;
}

const device = () => query(".track-record-device");
const collapsed = () =>
  device().className.includes("fx-device-panel--collapsed");
const deviceButton = (name: RegExp | string) =>
  page.elementLocator(device()).getByRole("button", { name });
const firstInChain = () =>
  (query(".fx-chain").firstElementChild as HTMLElement).className;

describe(TrackRecordDevice, { timeout: 60_000 }, () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(
      <TimelineHarness project={projectWithMedia([testPatternVideo()])} />,
    );
    await expect.poll(() => query(".source-span")).toBeTruthy();
  });

  test("a source track's Record device folds and arms", async () => {
    // Selecting the track shows the device collapsed, first in the chain.
    await page.elementLocator(query(".track-label--source")).click();
    await expect
      .poll(() => document.querySelectorAll(".track-record-device"))
      .toHaveLength(1);
    expect(collapsed()).toBe(true);
    const arm = deviceButton(/^Arm .+ for recording$/);
    await expect.element(arm).toHaveAttribute("aria-pressed", "false");
    expect(firstInChain()).toMatch(/track-record-device/);
    const global = () => query('.fx-chain [data-fx-divider="global"]');
    expect(left(device())).toBeLessThan(left(global()));

    // Arming expands it.
    await arm.click();
    await expect.poll(collapsed).toBe(false);
    const disarm = deviceButton(/^Disarm /);
    await expect.element(disarm).toHaveAttribute("aria-pressed", "true");

    // Selecting the track's clip keeps the device and its arm state.
    await page.elementLocator(query(".source-span")).click();
    // Record still comes first, left of the Clip device, which is left of
    // the Global divider.
    await expect
      .poll(() => document.querySelectorAll(".source-clip-properties"))
      .toHaveLength(1);
    expect(firstInChain()).toMatch(/track-record-device/);
    const clipLeft = left(query(".source-clip-properties"));
    expect(left(device())).toBeLessThan(clipLeft);
    expect(clipLeft).toBeLessThan(left(global()));
    expect(collapsed()).toBe(false);
    await expect.element(disarm).toHaveAttribute("aria-pressed", "true");

    // Disarming folds it, and the previews stop.
    await disarm.click();
    await expect.poll(collapsed).toBe(true);
    expect(
      page.elementLocator(device()).getByLabelText("Camera preview").elements(),
    ).toHaveLength(0);

    // Expanded by hand, it stays expanded through arming and disarming.
    await deviceButton("Expand Record").click();
    await deviceButton(/^Arm /).click();
    await expect.element(deviceButton(/^Disarm /)).toBeVisible();
    await deviceButton(/^Disarm /).click();
    await expect.element(deviceButton(/^Arm /)).toBeVisible();
    expect(collapsed()).toBe(false);
    await deviceButton("Collapse Record").click();
    await expect.poll(collapsed).toBe(true);
  });
});
