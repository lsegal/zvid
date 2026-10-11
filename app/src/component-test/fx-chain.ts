import { cdp, userEvent } from "vitest/browser";
import { patchProjectState } from "../app/session-project.ts";
import type { ProjectState } from "../app/types.ts";
import { createLaneId, getNextLaneName, insertLane } from "../lanes";

// FX chain helpers for the panel, drag and menu tests.

// The project after "Insert layer below" on its last layer, `count` times:
// Layer 2 is "2", Layer 3 is "3", each with its own Layout.
export function withLayers(project: ProjectState, count = 2) {
  let next = project;
  for (let index = 0; index < count; index += 1) {
    const lane = {
      id: createLaneId(next.lanes),
      name: getNextLaneName(next.lanes),
      colorIndex: -1,
    };
    next = patchProjectState(next, insertLane(next, next.lanes.length, lane));
  }
  return next;
}

// Matches `(prefers-reduced-motion: reduce)`, as Playwright's
// emulateMedia({ reducedMotion: "reduce" }) does. Chromium only.
export async function emulateReducedMotion(enabled = true) {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [
      {
        name: "prefers-reduced-motion",
        value: enabled ? "reduce" : "",
      },
    ],
  });
}

// The device `name` on stack `group`, attached Animation section or not.
export function stackDeviceSelector(group: string, name: string) {
  return `.fx-chain :is(section[data-fx-group="${group}"], [data-fx-group="${group}"] > section)[aria-label="${name}"]`;
}

export function stackDevices(group: string, name: string) {
  return [
    ...document.querySelectorAll<HTMLElement>(stackDeviceSelector(group, name)),
  ];
}

export function stackDevice(group: string, name: string) {
  const element = stackDevices(group, name)[0];
  if (!element) {
    throw new Error(`No ${name} device on the ${group} stack`);
  }
  return element;
}

// A device with its attached Animation section: one panel of its stack.
export function stackUnit(group: string, name: string) {
  const element = document.querySelector<HTMLElement>(
    `.fx-chain :is(section[data-fx-group="${group}"][aria-label="${name}"], [data-fx-group="${group}"]:has(> section[aria-label="${name}"]))`,
  );
  if (!element) {
    throw new Error(`No ${name} unit on the ${group} stack`);
  }
  return element;
}

// The chain's status line, which announces moves, copies and clears.
export function chainStatus() {
  return document.querySelector(".fx-chain__status")?.textContent;
}

// Waits two animation frames, so a drag's marker renders.
export function nextFrames() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
}

// Ctrl+Z, which FxEditor's history shortcuts take as Mod+Z.
export async function undo() {
  await userEvent.keyboard("{Control>}z{/Control}");
}
