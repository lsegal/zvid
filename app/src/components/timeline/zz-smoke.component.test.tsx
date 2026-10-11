import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { TimelineHarness } from "./timeline-harness";
import { mouse } from "./timeline-harness-input";

test("smoke", async () => {
  await page.viewport(1600, 1200);
  const screen = await render(<TimelineHarness />);
  await expect.element(screen.getByText("Layer 1")).toBeVisible();
  const frame = window.frameElement?.getBoundingClientRect();
  const lane = document.querySelector('[data-timeline-lane-id="1"]') as HTMLElement;
  const r = lane.getBoundingClientRect();
  console.log("frame", JSON.stringify(frame), "lane", JSON.stringify(r), innerWidth, innerHeight);
  let got: unknown = null;
  document.addEventListener("pointerdown", (e) => { got = [e.clientX, e.clientY, (e.target as HTMLElement).className, e.isTrusted]; }, true);
  await mouse.click(r.x + 200, r.y + 20);
  console.log("got", JSON.stringify(got));
});
