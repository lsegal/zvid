import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { renderTimelineEditor } from "../component-test/timeline-editor.tsx";

test("geo", async () => {
  const screen = await renderTimelineEditor();
  await expect.element(screen.getByText("Layer 1").first()).toBeVisible();
  const r = (s: string) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return [s, Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)].join(" ");
  };
  const scroll = document.querySelector(".timeline-scroll") as HTMLElement;
  console.log([".app-shell", ".timeline-panel", ".timeline-scroll", ".ruler-row", ".ruler-row__content", ".ruler-loop-strip", '[data-timeline-lane-id="1"]', ".transport-bar", ".fx-panel", ".timeline-toolbar"].map(r).join("\n"), scroll.scrollWidth - scroll.clientWidth);
  await page.screenshot({ path: "/tmp/geo63413.png" });
});
