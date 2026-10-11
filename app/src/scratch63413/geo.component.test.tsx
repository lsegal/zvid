import { expect, test } from "vitest";
import { down, move, up } from "../component-test/timeline-mouse.ts";

test("capture", async () => {
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:100px;top:100px;width:100px;height:100px;background:red";
  document.body.append(box);
  const log: string[] = [];
  box.addEventListener("pointerdown", (e) => {
    try { box.setPointerCapture(e.pointerId); log.push(`cap ${e.pointerId} ${box.hasPointerCapture(e.pointerId)}`); } catch (err) { log.push(String(err)); }
  });
  box.addEventListener("pointermove", (e) => log.push(`move ${e.clientY}`));
  box.addEventListener("lostpointercapture", () => log.push("lost"));
  for (const button of ["left", "right"] as const) {
    await move(150, 150);
    await down({ button });
    await move(150, 50, { steps: 2 });
    await up({ button });
  }
  expect(log).toEqual([]);
});
