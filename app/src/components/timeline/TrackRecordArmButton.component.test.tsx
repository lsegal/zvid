import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { PhoneShell } from "../../component-test/shells.tsx";
import { usePhone, useTablet } from "../../component-test/viewport.ts";
import {
  projectWithMedia,
  TimelineHarness,
  testPatternVideo,
} from "./timeline-harness";
import { TrackRecordArmButton } from "./TrackRecordArmButton";

const track = { id: "track-1", name: "Camera" };

function TrackLabel() {
  return (
    <div className="track-label">
      <TrackRecordArmButton track={track} />
    </div>
  );
}

describe("TrackRecordArmButton", () => {
  test("shows in the desktop track label", async () => {
    const screen = await render(<TrackLabel />);
    await expect
      .element(screen.getByRole("button", { name: "Arm Camera for recording" }))
      .toBeVisible();
  });

  // mobile-timeline.css leaves the arm switch out of the phone's narrow
  // track labels.
  test("is hidden in the phone shell's track label", async () => {
    await usePhone();
    const screen = await render(
      <PhoneShell>
        <TrackLabel />
      </PhoneShell>,
    );
    const button = screen.container.querySelector(".track-label__arm");
    expect(getComputedStyle(button as Element).display).toBe("none");
  });

  // coarse-pointer.css gives it a 44px touch target on a tablet, which
  // keeps the desktop layout, without growing the button itself.
  test("takes a 44px touch on a tablet", async () => {
    await useTablet();
    const screen = await render(<TrackLabel />);
    const button = screen.container.querySelector(".track-label__arm");
    const hitArea = getComputedStyle(button as Element, "::before");
    expect(hitArea.content).toBe('""');
    expect(hitArea.height).toBe("44px");
  });
});

// The source track handle's arm button and the Record device the selected
// track leads the Effects pane with arm the same track, so each follows the
// other.
describe("TrackRecordArmButton with the Record device", { timeout: 60_000 }, () => {
  test("follows the device, and arms the device back", async () => {
    localStorage.clear();
    await render(
      <TimelineHarness project={projectWithMedia([testPatternVideo()])} />,
    );
    await expect
      .poll(() => document.querySelector(".track-label--source"))
      .toBeTruthy();
    await page
      .elementLocator(
        document.querySelector(".track-label--source") as HTMLElement,
      )
      .click();
    const device = () =>
      document.querySelector(".track-record-device") as HTMLElement;
    await expect.poll(device).toBeTruthy();
    const collapsed = () =>
      device().className.includes("fx-device-panel--collapsed");
    const deviceArm = () =>
      page
        .elementLocator(device())
        .getByRole("button", { name: /^(Arm .+ for recording|Disarm .+)$/ });
    const handleArm = () =>
      document.querySelector(".track-label__arm") as HTMLElement;

    await deviceArm().click();
    await expect.poll(collapsed).toBe(false);
    await expect.element(deviceArm()).toHaveAttribute("aria-pressed", "true");
    // The track handle's arm button follows, and arms the device back.
    expect(handleArm().getAttribute("aria-pressed")).toBe("true");
    await page.elementLocator(handleArm()).click();
    await expect.element(deviceArm()).toHaveAttribute("aria-pressed", "false");
    await expect.poll(collapsed).toBe(true);
    await page.elementLocator(handleArm()).click();
    await expect.element(deviceArm()).toHaveAttribute("aria-pressed", "true");
    await expect.poll(collapsed).toBe(false);
    // Disarmed again, so no other test finds it armed.
    await page.elementLocator(handleArm()).click();
    await expect.poll(() => handleArm().getAttribute("aria-pressed")).toBe(
      "false",
    );
  });
});
