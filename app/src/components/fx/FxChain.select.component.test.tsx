import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { INITIAL_PROJECT_STATE } from "../../app/constants.ts";
import type { ProjectState } from "../../app/types.ts";
import {
  stackDevice,
  stackUnit,
  withLayers,
} from "../../component-test/fx-chain.ts";
import {
  FxEditor,
  type FxEditorProps,
} from "../../component-test/fx-editor.tsx";
import { EMPTY_PROJECT, withEffect } from "../../component-test/fx-projects.ts";
import { centerOf, mouse } from "../../component-test/mouse.ts";
import {
  type FxDevice,
  GLOBAL_EFFECT_TRACK_ID,
  sourceClipEffectTrackId,
} from "../../fx-stack";
import { addDefaultSynth } from "../../midi-effects.ts";

// Clicking a device in the effects panel selects it (#1616): one effect at a
// time across its stacks, read by features that target it, such as MIDI
// mappings.

const SPAN_ID = "source-bassline";

// A Bass track's MIDI clip, played by a Synth behind an Arpeggiator's notes.
function midiProject(): ProjectState {
  const base: ProjectState = {
    ...INITIAL_PROJECT_STATE,
    sourceTracks: [
      { id: "bass", name: "Bass", colorIndex: 2, recordingPaths: [] },
    ],
    sourceSpans: [
      {
        id: SPAN_ID,
        sourceTrackId: "bass",
        label: "Bassline",
        mediaPath: "",
        startQ: 0,
        durationSeconds: 4,
        trimStartSeconds: 0,
        notes: [],
        tint: "#1c2340",
        accent: "#7ca1ff",
      },
    ],
    effects: addDefaultSynth(INITIAL_PROJECT_STATE.effects, SPAN_ID, "synth"),
  };
  return withEffect(base, sourceClipEffectTrackId(SPAN_ID), "Arpeggiator")
    .project;
}

async function open(props: FxEditorProps) {
  const selected: { current: FxDevice | undefined } = { current: undefined };
  const screen = await render(
    <FxEditor
      {...props}
      onSelectedFxDevice={(device) => {
        selected.current = device;
      }}
    />,
  );
  const show = (next: FxEditorProps["selection"]) =>
    screen.rerender(
      <FxEditor
        {...props}
        onSelectedFxDevice={(device) => {
          selected.current = device;
        }}
        selection={next}
      />,
    );
  return { selected, show };
}

const name = (device: string) =>
  page
    .getByRole("region", { name: device, exact: true })
    .getByRole("button", { name: new RegExp(`^${device}`) })
    .first();
const selectedNames = () =>
  [...document.querySelectorAll<HTMLElement>(".fx-device-panel--selected")].map(
    (panel) => panel.getAttribute("aria-label"),
  );

test("clicking a device selects it instead of the one before", async () => {
  const { selected } = await open({
    project: midiProject(),
    selection: { source: { sourceTrackId: "bass", sourceSpanId: SPAN_ID } },
  });
  expect(selected.current).toBeUndefined();
  expect(selectedNames()).toEqual([]);

  await name("Arpeggiator").click();
  await expect.poll(() => selected.current?.name).toBe("Arpeggiator");
  expect(selectedNames()).toEqual(["Arpeggiator"]);
  const arpeggiator = stackDevice("clip", "Arpeggiator");
  expect(getComputedStyle(arpeggiator).outlineStyle).toBe("solid");
  expect(getComputedStyle(arpeggiator).outlineWidth).toBe("2px");
  await expect.element(name("Arpeggiator")).toHaveAttribute("aria-current");

  // The device's body, here its padding, selects it just as the title does.
  const body = stackDevice("clip", "Synth").querySelector<HTMLElement>(
    ".fx-device-panel__body",
  );
  if (!body) {
    throw new Error("The Synth has no body");
  }
  const box = body.getBoundingClientRect();
  await mouse.click(box.left + 1, box.top + 1);
  await expect.poll(() => selected.current?.name).toBe("Synth");
  expect(selectedNames()).toEqual(["Synth"]);
  expect(getComputedStyle(arpeggiator).outlineStyle).toBe("none");
});

test("the device's name selects it from the keyboard", async () => {
  const { selected } = await open({
    project: withEffect(EMPTY_PROJECT, "1", "Pixelate").project,
    selection: { laneId: "1" },
  });
  (await name("Pixelate").element()).focus();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => selected.current?.name).toBe("Pixelate");
});

test("selecting a folded device selects it as it expands", async () => {
  const { selected } = await open({
    project: withEffect(EMPTY_PROJECT, "1", "Pixelate").project,
    selection: { laneId: "1" },
  });
  await page.getByRole("button", { name: "Collapse Pixelate" }).click();
  expect(selected.current).toBeUndefined();

  await page.getByRole("button", { name: "Expand Pixelate" }).click();
  await expect.poll(() => selected.current?.name).toBe("Pixelate");
  await expect
    .element(page.getByRole("button", { name: "Collapse Pixelate" }))
    .toBeVisible();
});

test("a device's controls leave the selection alone", async () => {
  const { selected } = await open({
    project: withEffect(EMPTY_PROJECT, "1", "Pixelate").project,
    selection: { laneId: "1" },
  });
  await page.getByRole("button", { name: "Bypass Pixelate" }).click();
  await page.getByRole("button", { name: "Enable Pixelate" }).click();

  const knob = stackDevice("layer", "Pixelate").querySelector<HTMLElement>(
    '[role="slider"]',
  );
  if (!knob) {
    throw new Error("The Pixelate has no knob");
  }
  // A click, then a drag released off the knob.
  const { x, y } = centerOf(knob);
  await mouse.click(x, y);
  await mouse.move(x, y);
  await mouse.down();
  await mouse.move(x, y + 30, { steps: 4 });
  await mouse.up();

  expect(selected.current).toBeUndefined();
  expect(selectedNames()).toEqual([]);
});

test("a device and its Animation section select as one panel", async () => {
  const { selected } = await open({
    project: withEffect(EMPTY_PROJECT, "1", "Pixelate").project,
    selection: { laneId: "1" },
  });
  // A Pixelate starts with its Animation section on.
  // A menu in the section portals out, though React bubbles its clicks here.
  const animation = page.getByRole("region", { name: "Pixelate animation" });
  await animation.getByRole("button", { name: "Reactive" }).click();
  await animation.getByRole("button", { name: /^Parameters/ }).click();
  await page.getByRole("menuitemcheckbox").first().click();
  await userEvent.keyboard("{Escape}");
  expect(selected.current).toBeUndefined();

  await animation.getByText("Animation", { exact: true }).click();
  await expect.poll(() => selected.current?.name).toBe("Pixelate");
  const unit = stackUnit("layer", "Pixelate");
  expect(getComputedStyle(unit).outlineStyle).toBe("solid");
  expect(getComputedStyle(stackDevice("layer", "Pixelate")).outlineStyle).toBe(
    "none",
  );
});

test("selection follows what the panel shows", async () => {
  const layerOne = withEffect(
    withLayers(EMPTY_PROJECT),
    "1",
    "Pixelate",
  ).project;
  const project = withEffect(layerOne, "2", "Bloom").project;
  const { selected, show } = await open({
    project,
    selection: { laneId: "1" },
  });
  await name("Pixelate").click();
  await expect.poll(() => selected.current?.name).toBe("Pixelate");

  // Another layer's stack doesn't show it, so nothing is selected.
  await show({ laneId: "2" });
  await expect.element(name("Bloom")).toBeVisible();
  expect(selected.current).toBeUndefined();
  expect(selectedNames()).toEqual([]);

  await show({ laneId: "1" });
  await expect.poll(() => selected.current?.name).toBe("Pixelate");
});

test("a Global effect stays selected and removing it clears selection", async () => {
  const withGlobal = withEffect(
    withLayers(EMPTY_PROJECT),
    GLOBAL_EFFECT_TRACK_ID,
    "Pixelate",
  ).project;
  const project = withEffect(withGlobal, "1", "Bloom").project;
  const { selected, show } = await open({
    project,
    selection: { laneId: "1" },
  });
  await name("Bloom").click();
  await expect.poll(() => selected.current?.name).toBe("Bloom");
  await name("Pixelate").click();
  await expect.poll(() => selected.current?.group).toBe("global");
  expect(selectedNames()).toEqual(["Pixelate"]);

  await show({ laneId: "2" });
  await expect.poll(() => document.querySelector(".fx-chain")).toBeTruthy();
  expect(selected.current?.name).toBe("Pixelate");

  await page.getByRole("button", { name: "Remove Pixelate" }).click();
  await expect.poll(() => selected.current).toBeUndefined();
});
