import { expect, test } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { TimelineHarness } from "./timeline-harness";

test("smoke", async () => {
  await page.viewport(1600, 1200);
  const screen = await render(<TimelineHarness />);
  await expect.element(screen.getByText("Layer 1")).toBeVisible();
  const frame = window.frameElement?.getBoundingClientRect();
  const lane = document.querySelector('[data-timeline-lane-id="1"]') as HTMLElement;
  const r = lane.getBoundingClientRect();
  console.log("frame", JSON.stringify(frame), "lane", JSON.stringify(r), innerWidth, innerHeight, window.parent === window);
  const parentFrame = window.frameElement as HTMLElement | null;
  console.log("transform", parentFrame ? getComputedStyle(parentFrame).transform : "none", parentFrame?.parentElement ? getComputedStyle(parentFrame.parentElement).transform : "");
  let got: any = null;
  document.addEventListener("pointerdown", (e) => { got = [e.clientX, e.clientY, (e.target as HTMLElement).className, e.isTrusted]; }, true);
  await cdp().send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x + 200, y: r.y + 20, button: "left", clickCount: 1 });
  await cdp().send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x + 200, y: r.y + 20, button: "left", clickCount: 1 });
  console.log("got", JSON.stringify(got));
});
