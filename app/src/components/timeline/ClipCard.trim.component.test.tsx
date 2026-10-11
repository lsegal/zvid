import { expect, test } from "vitest";
import { INITIAL_PROJECT_STATE } from "../../app/constants.ts";
import { renderTimelineEditor } from "../../component-test/timeline-editor.tsx";
import { addFillClip } from "../../fill-clip.ts";
import { ensureLayerLayouts } from "../../fx-stack.ts";
import { ClipCard } from "./ClipCard";

void ClipCard;

test("smoke", async () => {
  const lanes = [
    { id: "1", name: "Layer 1", colorIndex: -1 },
    { id: "2", name: "Layer 2", colorIndex: -1 },
  ];
  let project = {
    clips: [] as ReturnType<typeof addFillClip>["clips"],
    effects: ensureLayerLayouts(INITIAL_PROJECT_STATE.effects, ["1", "2"]),
  };
  for (const [id, laneId] of [["a", "1"], ["b", "2"]]) {
    project = addFillClip(project, {
      id, laneId, startQ: 0, durationQ: 8, bpm: 120, tint: "#2a2d38", accent: "#8d93a8", color: "#ff0000", effectId: `${id}-color`,
    });
  }
  const screen = await renderTimelineEditor({ project: { lanes, ...project } });
  await new Promise((r) => setTimeout(r, 500));
  const cards = [...document.querySelectorAll(".clip-card")].map((c) => [c.className, JSON.stringify(c.getBoundingClientRect())]);
  console.log(JSON.stringify(cards, null, 1));
  console.log(JSON.stringify([...document.querySelectorAll("[data-timeline-lane-id]")].map((c) => c.getBoundingClientRect())));
  console.log(document.querySelector(".timeline-scroll")?.getBoundingClientRect().toJSON());
  expect(screen).toBeTruthy();
});
