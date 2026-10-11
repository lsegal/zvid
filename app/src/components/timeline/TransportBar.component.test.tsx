import { beforeEach, describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import type { RenderResult } from "vitest-browser-react";
import { renderTimelineEditor } from "../../component-test/timeline-editor.tsx";
import { center, click } from "../../component-test/timeline-mouse.ts";
import { TransportBar } from "./TransportBar";

// The transport bar's zoom control: the -/+ buttons step along a ladder from
// 25% to 300%, and the ruler thins its labels when zoomed far out.

let screen: RenderResult;

function readout() {
  return screen.container.querySelector(".zoom-control__readout")
    ?.textContent;
}

async function stepUntilDisabled(name: "Zoom in" | "Zoom out") {
  const button = screen.getByRole("button", { name, exact: true });
  const seen: string[] = [];
  while (!(button.element() as HTMLButtonElement).disabled) {
    const before = readout();
    const { x, y } = center(button.element());
    await click(x, y);
    await expect.poll(readout).not.toBe(before);
    seen.push(readout() ?? "");
  }
  return seen;
}

describe(TransportBar, () => {
  beforeEach(async () => {
    screen = await renderTimelineEditor();
    await expect.poll(readout).toBe("100%");
  });

  test("the zoom buttons step along the ladder to 25% and 300%", async () => {
    expect(await stepUntilDisabled("Zoom out")).toEqual([
      "80%",
      "67%",
      "50%",
      "33%",
      "25%",
    ]);
    expect(await stepUntilDisabled("Zoom in")).toEqual([
      "33%",
      "50%",
      "67%",
      "80%",
      "100%",
      "125%",
      "150%",
      "200%",
      "250%",
      "300%",
    ]);
  });

  test("the slider reaches both ends of the range", async () => {
    const slider = screen.getByRole("slider", { name: "Timeline zoom" });
    (slider.element() as HTMLElement).focus();
    await userEvent.keyboard("{Home}");
    await expect.poll(readout).toBe("25%");
    await userEvent.keyboard("{End}");
    await expect.poll(readout).toBe("300%");
  });

  test("the ruler labels fewer bars at 25%", async () => {
    const labeled = () =>
      [...screen.container.querySelectorAll(".ruler-marker span")]
        .slice(0, 4)
        .map((label) => Number(label.textContent));
    expect(labeled()).toEqual([1, 2, 3, 4]);

    await stepUntilDisabled("Zoom out");
    // A 4/4 bar is 28px at 25%, so every 2nd bar keeps its number.
    await expect.poll(labeled).toEqual([1, 3, 5, 7]);
  });
});
