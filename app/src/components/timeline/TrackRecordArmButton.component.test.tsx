import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { PhoneShell } from "../../component-test/shells.tsx";
import { usePhone, useTablet } from "../../component-test/viewport.ts";
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
