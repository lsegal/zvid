import { expect, test } from "vitest";
import { renderTimelineEditor } from "../component-test/timeline-editor.tsx";
import { click } from "../component-test/timeline-mouse.ts";

test("geo", async () => {
  const screen = await renderTimelineEditor();
  await expect.element(screen.getByText("Layer 1").first()).toBeVisible();
  const hits: string[] = [];
  window.addEventListener("pointerdown", (e) => hits.push(`${e.clientX},${e.clientY} ${(e.target as Element).className}`), true);
  await click(600, 90);
  await click(10, 10);
  await click(300, 140);
  expect([hits.join("\n"), window.devicePixelRatio, innerWidth, innerHeight, document.querySelector(".source-tracks, [aria-label='Source track drop area']")?.getBoundingClientRect().y]).toBe(0);
});
