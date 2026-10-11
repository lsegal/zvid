import { expect, test } from "vitest";
import {
  renderEditor,
  sessionWithLayers,
  withFillClip,
  withTestPatternTrack,
} from "../../component-test/editor-harness.tsx";
import { ClipCard } from "./ClipCard";

void ClipCard;

test("smoke", async () => {
  let project = withTestPatternTrack(sessionWithLayers(2));
  project = withFillClip(project, { id: "a", laneId: "1" });
  project = withFillClip(project, { id: "b", laneId: "2" });
  const screen = await renderEditor({ project });
  await new Promise((r) => setTimeout(r, 1500));
  const cards = [...document.querySelectorAll(".clip-card, .source-span, [data-timeline-lane-id], .timeline-scroll, .fx-panel__toggle, .topbar")].map((c) => [c.className.slice(0,40), JSON.stringify(c.getBoundingClientRect().toJSON())]);
  console.log(JSON.stringify(cards, null, 1));
  console.log(document.querySelectorAll(".source-span__tile").length);
  expect(screen).toBeTruthy();
});
