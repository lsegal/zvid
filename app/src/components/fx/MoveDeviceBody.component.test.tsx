import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ProjectState } from "../../app/types.ts";
import { withLayers } from "../../component-test/fx-chain.ts";
import { FxEditor } from "../../component-test/fx-editor.tsx";
import { EMPTY_PROJECT, withEffect } from "../../component-test/fx-projects.ts";
import { selectMovePoint } from "../../fx/effects/move/move-point-selection.ts";
import type { ProjectHistoryState } from "../../project-history";

// A Move device's point chips and its one placement row: the chips pick
// which point the row edits, a dimmed chip adds the next waypoint, and
// Remove takes the selected one out. There is no Waypoints count control.

async function openMove(parameters: Record<string, number | string> = {}) {
  const { project, effectId } = withEffect(
    withLayers(EMPTY_PROJECT, 1),
    "2",
    "Move",
    parameters,
  );
  let latest: ProjectState = project;
  await render(
    <FxEditor
      project={project}
      selection={{ laneId: "2" }}
      onChange={(history: ProjectHistoryState<ProjectState>) => {
        latest = history.present;
      }}
    />,
  );
  const device = page.getByRole("region", { name: "Move" });
  await expect.element(device).toBeVisible();
  const value = (key: string) =>
    latest.effects
      .find((effect) => effect.id === effectId)
      ?.parameters.find((parameter) => parameter.key === key)?.value;
  return { device, effectId, value };
}

function rowLabel() {
  return document.querySelector(
    'section[aria-label="Move"] .fx-device-panel__knob-row legend',
  )?.textContent;
}

function rowKnobCount() {
  return document.querySelectorAll(
    'section[aria-label="Move"] .fx-device-panel__knob-row > :not(legend)',
  ).length;
}

describe("Move device", () => {
  test("shows point chips and one placement row, with no Waypoints control", async () => {
    const { device } = await openMove();

    await expect
      .element(device.getByRole("button", { name: "Start" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(device.getByRole("button", { name: "End" }))
      .toBeVisible();
    await expect
      .element(device.getByRole("button", { name: "Add Waypoint 1" }))
      .toBeEnabled();
    await expect
      .element(device.getByRole("button", { name: "Add Waypoint 2" }))
      .toBeDisabled();
    expect(
      document.querySelectorAll(
        'section[aria-label="Move"] .fx-device-panel__knob-row',
      ).length,
    ).toBe(1);
    expect(rowLabel()).toBe("Start");
    expect(rowKnobCount()).toBe(7);
    expect(device.element().textContent).not.toContain("Waypoints");

    await device.getByRole("button", { name: "End" }).click();
    expect(rowLabel()).toBe("End");
    expect(rowKnobCount()).toBe(7);
  });

  test("a dimmed chip adds a waypoint halfway along the last leg, and Remove takes it out", async () => {
    const { device, value } = await openMove({ EndPositionX: 0.5 });

    await device.getByRole("button", { name: "Add Waypoint 1" }).click();
    await expect.poll(() => value("Waypoints")).toBe("1");
    expect(Number(value("Point1PositionX"))).toBeCloseTo(0.25);
    await expect
      .element(device.getByRole("button", { name: "Waypoint 1", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    expect(rowLabel()).toBe("Point 1");

    await device.getByRole("button", { name: "Remove Waypoint 1" }).click();
    await expect.poll(() => value("Waypoints")).toBe("0");
    expect(rowLabel()).toBe("Start");
  });

  test("follows the point selected on the preview's path", async () => {
    const { device, effectId } = await openMove({ Waypoints: "2" });

    selectMovePoint(effectId, 2);
    await expect
      .element(device.getByRole("button", { name: "Waypoint 2", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    expect(rowLabel()).toBe("Point 2");
  });
});
