import { expect, test } from "vitest";
import { usePhone } from "../../component-test/viewport.ts";
import { renderApp, touch, centerOf, addClip, drag, playheadQ } from "../../mobile/phone-app-test-utils.tsx";

test("smoke", async () => {
  await usePhone();
  await renderApp();
  const shell = document.querySelector(".app-shell");
  console.log(shell?.className, document.documentElement.scrollHeight, innerHeight, innerWidth, JSON.stringify(window.frameElement?.getBoundingClientRect()));
  const seen: number[][] = [];
  document.addEventListener("touchstart", (e) => seen.push([e.touches[0].clientX, e.touches[0].clientY]), { capture: true });
  const c = centerOf(".timeline-scroll");
  await touch("touchStart", [c]);
  await touch("touchEnd", []);
  console.log(JSON.stringify(c), JSON.stringify(seen));
  await addClip();
  console.log("clips", document.querySelectorAll(".clip-card").length);
  const y = centerOf(".clip-card").y;
  await drag({ x: c.x + 100, y }, { x: c.x - 60, y });
  await expect.poll(() => playheadQ()).toBeGreaterThan(1);
});
