import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { AudioRow } from "./AudioRow";
import { TimelineHarness } from "./timeline-harness";
import { menuItem, rightClick } from "./timeline-harness-input";

// The Audio row docked under the timeline's rows.

describe(AudioRow, { timeout: 180_000 }, () => {
  test("only offers to recompute the audio", async () => {
    localStorage.clear();
    await render(<TimelineHarness />);
    await expect
      .poll(() => document.querySelector("[data-audio-row]"))
      .toBeTruthy();
    const audioRow = document.querySelector("[data-audio-row]") as HTMLElement;
    // It takes no files: no picker, and no import or replace button.
    expect(audioRow.querySelectorAll('input[type="file"]')).toHaveLength(0);
    expect(
      page
        .elementLocator(audioRow)
        .getByRole("button", { name: /main audio/i })
        .elements(),
    ).toHaveLength(0);
    await rightClick(audioRow.querySelector(".track-label") as HTMLElement);
    const menu = page.getByRole("menu", { name: "Audio actions" });
    await expect.element(menu).toBeVisible();
    expect(
      menu
        .getByRole("menuitem")
        .elements()
        .map((item) => item.textContent),
    ).toEqual(["Recompute audio"]);

    await menuItem("Recompute audio").click();
    await expect.element(menu).not.toBeInTheDocument();
  });
});
