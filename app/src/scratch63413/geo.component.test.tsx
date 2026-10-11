import { expect, test } from "vitest";
import { renderTimelineEditor } from "../component-test/timeline-editor.tsx";
import { down, move, up } from "../component-test/timeline-mouse.ts";

test("geo", async () => {
  await renderTimelineEditor({ reducedMotion: true });
  const log: string[] = [];
  for (const t of ["pointerdown", "pointermove", "pointerup", "contextmenu", "lostpointercapture", "gotpointercapture", "pointercancel"]) {
    window.addEventListener(t, (e) => log.push(`${t} ${(e as PointerEvent).clientY} b${(e as PointerEvent).buttons} ${(e.target as Element).className} ${(e.target as Element).isConnected} ${e.defaultPrevented}`), true);
  }
  const zoom = () => (document.querySelector('input[aria-label="Timeline zoom"]') as HTMLElement).dataset.zoom;
  const ruler = document.querySelector(".ruler-row__content")!.getBoundingClientRect();
  const x = 700, y = ruler.y + ruler.height / 2;
  await move(x, y);
  await down({ button: "right" });
  await move(x, y - 60, { steps: 6 });
  log.push(document.activeElement?.className ?? '');
  log.push(`zoom ${zoom()} cls ${document.querySelector(".ruler-row")!.className}`);
  await move(x, y - 100, { steps: 6 });
  await up({ button: "right" });
  await new Promise((r) => setTimeout(r, 300));
  log.push(`zoom ${zoom()} mm ${matchMedia("(prefers-reduced-motion: reduce)").matches}`);
  expect(log).toEqual([]);
});
