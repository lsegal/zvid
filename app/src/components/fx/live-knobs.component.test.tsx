import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { center, drag } from "../../component-test/input.ts";
import { createDefaultAnimation } from "../../fx-animation-defaults.ts";
import { createDefaultModulation } from "../../fx-modulation-defaults.ts";
import {
  createEffect,
  type FxDevice,
  GLOBAL_EFFECT_TRACK_ID,
  mapSessionEffectsToDevices,
} from "../../fx-stack.ts";
import { createPlayheadSignal } from "../../playhead-signal.ts";
import { DEFAULT_SIGNATURE } from "../../time-signature.ts";
import { NumberControl } from "./controls/NumberControl.tsx";
import {
  type FxModulationClock,
  FxModulationClockContext,
} from "./modulation-clock.ts";
import type { FxSetParameter } from "./types.ts";

// While Animation or Modulation moves a knob, it shows where it has moved
// to beside where it is set, following the playhead without the FX chain
// re-rendering.

const BPM = 120;

function device(effectName: string, id: string, changes: Partial<FxDevice>) {
  const [found] = mapSessionEffectsToDevices(
    [createEffect(GLOBAL_EFFECT_TRACK_ID, effectName, id)],
    undefined,
  ).filter((candidate) => candidate.id === id);
  return { ...found, ...changes };
}

// A NegativeSplit whose Low knob swings with Animation's LFO, once a
// second, by its whole Depth.
function splitWithLfo(enabled: boolean, low = 0.5): FxDevice {
  const animation = createDefaultAnimation("NegativeSplit");
  if (!animation?.lfo) {
    throw new Error("NegativeSplit has no LFO");
  }
  const split = device("NegativeSplit", "split-1", {
    animation: {
      ...animation,
      enabled,
      mode: "lfo",
      lfo: {
        ...animation.lfo,
        sync: false,
        rate: 1,
        depth: 1,
        phase: 0,
        shape: "Sine",
        parameters: ["_LowIntensity"],
      },
    },
  });
  return {
    ...split,
    parameters: split.parameters.map((parameter) =>
      parameter.key === "_LowIntensity"
        ? { ...parameter, numericValue: low }
        : parameter,
    ),
  };
}

function Harness({
  initial,
  clock,
  onSetParameter,
}: {
  initial: FxDevice;
  clock: FxModulationClock;
  onSetParameter: FxSetParameter;
}) {
  const [current, setCurrent] = useState(initial);
  const set: FxSetParameter = (target, key, value, mode) => {
    onSetParameter(target, key, value, mode);
    setCurrent((before) => ({
      ...before,
      parameters: before.parameters.map((parameter) =>
        parameter.key === key && typeof value === "number"
          ? { ...parameter, numericValue: value }
          : parameter,
      ),
    }));
  };
  return (
    <FxModulationClockContext.Provider value={clock}>
      {current.parameters
        .filter((parameter) => parameter.kind === "number")
        .map((parameter) => (
          <NumberControl
            key={parameter.key}
            device={current}
            parameter={parameter}
            layers={[]}
            onSetParameter={set}
          />
        ))}
    </FxModulationClockContext.Provider>
  );
}

function clockAt(seconds: number): FxModulationClock {
  return {
    signal: createPlayheadSignal((seconds * BPM) / 60),
    bpm: BPM,
    signature: DEFAULT_SIGNATURE,
    isPlaying: false,
  };
}

const knob = (index: number) =>
  document.querySelectorAll<HTMLElement>(".knob")[index];

// A knob's readout, such as 50 for "50%".
const readout = (element: HTMLElement) =>
  Number.parseFloat(
    element.querySelector(".knob__value-text")?.textContent ?? "",
  );

describe("live knobs", { timeout: 60_000 }, () => {
  test("an animated knob shows where it has moved to and follows the playhead", async () => {
    const onSetParameter = vi.fn<FxSetParameter>();
    const clock = clockAt(0.25);
    await render(
      <Harness
        initial={splitWithLfo(true)}
        clock={clock}
        onSetParameter={onSetParameter}
      />,
    );

    const low = knob(0);
    const high = knob(1);
    const lowDial = low.querySelector<HTMLElement>('[role="slider"]');
    if (!lowDial) {
      throw new Error("no dial");
    }
    // A quarter second in, the Sine is at its peak: the knob reads out
    // above where it is set, which the slider still reports.
    await expect
      .poll(() => low.classList.contains("knob--automated"))
      .toBe(true);
    expect(lowDial.getAttribute("aria-valuenow")).toBe("0.5");
    expect(low.querySelector(".knob__live-pointer")).not.toBeNull();
    expect(low.querySelector(".knob__live-arc")).not.toBeNull();
    expect(readout(low)).toBeGreaterThan(50);
    // In a color of its own, apart from the set value's.
    const pointer = low.querySelector(".knob__live-pointer");
    const value = low.querySelector(".knob__value");
    expect(pointer && getComputedStyle(pointer).stroke).not.toBe(
      value && getComputedStyle(value).stroke,
    );
    expect(Number(pointer && getComputedStyle(pointer).opacity)).toBeLessThan(
      1,
    );

    // A knob the LFO doesn't move looks as it always has.
    expect(high.classList.contains("knob--automated")).toBe(false);
    expect(high.querySelector(".knob__live-pointer")).toBeNull();

    // Scrubbed to the trough, it follows.
    clock.signal.set((0.75 * BPM) / 60);
    await expect.poll(() => readout(low)).toBeLessThan(50);
    // Following the playhead never edits the knob.
    expect(onSetParameter).not.toHaveBeenCalled();

    // Dragging edits where it is set, and it keeps following from there.
    const from = center(lowDial);
    await drag(from, { x: from.x, y: from.y - 40 });
    await expect
      .poll(() => onSetParameter.mock.calls.at(-1)?.[3])
      .toBe("commit");
    const committed = onSetParameter.mock.calls.at(-1)?.[2];
    expect(committed).toBeGreaterThan(0.5);
    await expect
      .poll(() => lowDial.getAttribute("aria-valuenow"))
      .toBe(String(committed));
    expect(low.classList.contains("knob--automated")).toBe(true);
  });

  test("a knob whose Animation is off looks as it always has", async () => {
    await render(
      <Harness
        initial={splitWithLfo(false)}
        clock={clockAt(0.25)}
        onSetParameter={vi.fn()}
      />,
    );
    expect(document.querySelectorAll(".knob--automated")).toHaveLength(0);
    expect(document.querySelectorAll(".knob__live-pointer")).toHaveLength(0);
    expect(readout(knob(0))).toBe(50);
  });

  test("a fader Modulation's LFO moves shows where it has moved to", async () => {
    const modulation = createDefaultModulation("Gain");
    if (!modulation) {
      throw new Error("Gain has no Modulation");
    }
    const gain = device("Gain", "gain-1", {
      modulation: {
        ...modulation,
        mode: "lfo",
        lfo: { ...modulation.lfo, sync: false, rate: 1, depth: 1, phase: 0 },
      },
    });
    await render(
      <Harness initial={gain} clock={clockAt(0.25)} onSetParameter={vi.fn()} />,
    );
    const fader = document.querySelector<HTMLElement>(".fader--automated");
    expect(fader).not.toBeNull();
    expect(fader?.querySelector(".fader__live-line")).not.toBeNull();
    expect(fader?.querySelector(".fader__live-band")).not.toBeNull();
  });
});
