import { expect, test } from "vitest";
import {
  expectCount,
  FIXTURES,
  query,
  renderApp,
} from "../component-test/app.tsx";
import type { ControlResult } from "../control/types.ts";
import "./useControlSurface.ts";

// The control surface App installs as `window.zvid`, driven the way an agent
// drives it: build a session from nothing, see the edits in the editor, and
// export it, without touching the UI.

// biome-ignore lint/suspicious/noExplicitAny: command results are JSON
type Json = any;

async function call(name: string, input?: unknown): Promise<Json> {
  const zvid = window.zvid;
  if (!zvid) throw new Error("window.zvid is not installed");
  const result: ControlResult = await zvid.call(name, input);
  if (!result.ok) {
    throw new Error(`${name}: ${result.error.code}: ${result.error.message}`);
  }
  return result.result;
}

test("an agent builds, edits and exports a session through window.zvid", async () => {
  await renderApp();
  expect(window.zvid?.tools().map((tool) => tool.name)).toContain("add_clip");

  // A small canvas keeps the export quick.
  const session = await call("update_session", {
    name: "Agent cut",
    canvasWidth: 320,
    canvasHeight: 180,
  });
  expect(session.name).toBe("Agent cut");
  const layerId = session.layers[0].id;

  // Silent video, so the export writes no audio track: Chromium on Linux
  // has no AAC encoder for an audible MP4.
  const imported = await call("import_media", {
    url: FIXTURES["test-pattern.mp4"].url,
    name: "pattern.mp4",
  });
  expect(imported.media).toHaveLength(1);
  expect(imported.sourceClips).toHaveLength(1);
  await expectCount(".source-span", 1);

  const media = await call("add_clip", {
    kind: "media",
    layerId,
    startBeats: 0,
    durationBeats: 4,
    sourceClipId: imported.sourceClips[0].id,
  });
  await expectCount(`.clip-card[data-clip-id="${media.clip.id}"]`, 1);
  expect(query(`[data-clip-id="${media.clip.id}"]`).className).toContain(
    "clip-card--selected",
  );

  const titles = await call("add_layer", { name: "Titles", index: 0 });
  const text = await call("add_clip", {
    kind: "text",
    layerId: titles.id,
    startBeats: 0,
    durationBeats: 2,
    text: "Made by a robot",
  });
  await expectCount(`.clip-card[data-clip-id="${text.clip.id}"]`, 1);

  const reverb = await call("add_effect", {
    effectName: "Reverb",
    target: "clip",
    targetId: media.clip.id,
  });
  await call("set_effect_parameter", {
    effectId: reverb.id,
    key: "Size",
    value: 0.75,
  });

  // Each command sees the edits before it, without waiting for a render.
  const state = await call("get_session");
  expect(
    state.layers.map((layer: { name: string }) => layer.name).slice(0, 2),
  ).toEqual(["Titles", "Layer 1"]);
  expect(
    state.effects.find((effect: { id: string }) => effect.id === reverb.id)
      .parameters.Size,
  ).toBe(0.75);
  expect(state.selectedClipId).toBe(text.clip.id);

  const exported = await call("export_video", { startBeats: 0, endBeats: 2 });
  expect(exported.fileName).toMatch(/^Agent cut\.(mp4|webm)$/);
  const file = await (await fetch(exported.url)).blob();
  expect(file.size).toBe(exported.bytes);
  expect(file.size).toBeGreaterThan(0);

  // Undo steps back through the agent's edits like the user's.
  expect(await call("undo")).toEqual({ undid: "Change Reverb Size" });
  await call("delete_clip", { clipId: text.clip.id });
  await expectCount(`.clip-card[data-clip-id="${text.clip.id}"]`, 0);
}, 120_000);
