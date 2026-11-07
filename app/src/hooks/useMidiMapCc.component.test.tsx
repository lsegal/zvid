import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { page, userEvent } from "vitest/browser";
import { sessionToProject } from "../app/session-project.ts";
import {
  EDITOR_TEST_TIMEOUT,
  type EditorState,
  renderEditor,
  sessionWithLayers,
  withTestPatternTrack,
} from "../component-test/editor.tsx";
import { undo } from "../component-test/input.ts";
import { createEffect, GLOBAL_EFFECT_TRACK_ID } from "../fx-stack.ts";
import { knobParameters } from "../midi-device-targets.ts";
import {
  COMPUTER_KEYBOARD_STORAGE_KEY,
  computerKeyboardEntry,
} from "../midi-input/computer-keyboard.ts";
import {
  type MidiAccessLike,
  type MidiInputPort,
  midiInputHub,
} from "../midi-input/input-hub.ts";
import { MIDI_INPUT_STORAGE_KEY } from "../midi-input/preferences.ts";
import { projectToSession } from "../session-save.ts";

// CC controls mapped by hand in MIDI Map mode (#1631), through a simulated
// device the app doesn't know and a simulated Launchkey 49 MK3, whose knobs send
// CC 21 on with a built-in role.

const ports = new Map<string, MidiInputPort>();
const access: MidiAccessLike = { inputs: ports, onstatechange: null };

function plugIn(name: string) {
  const port: MidiInputPort = {
    id: name,
    name,
    state: "connected",
    onmidimessage: null,
  };
  ports.set(port.id, port);
  access.onstatechange?.();
  return port;
}

function cc(
  port: MidiInputPort,
  controller: number,
  value: number,
  channel = 1,
) {
  port.onmidimessage?.({
    data: new Uint8Array([0xb0 + channel - 1, controller, value]),
  });
}

const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
// Past the debounce that turns a run of moves into one undo step.
const SETTLED_MS = 500;
const toggleButton = () =>
  page.getByRole("button", { name: /^MIDI (on|map)$/ });

async function open(port: MidiInputPort) {
  let state: EditorState | undefined;
  const delay = createEffect(GLOBAL_EFFECT_TRACK_ID, "Delay");
  const reverb = createEffect(GLOBAL_EFFECT_TRACK_ID, "Reverb");
  const session = sessionWithLayers(1);
  await renderEditor({
    project: withTestPatternTrack({
      ...session,
      effects: [...(session.effects ?? []), delay, reverb],
    }),
    onState: (next) => {
      state = next;
    },
  });
  const get = () => state as EditorState;
  const value = (id: string, key: string) =>
    get()
      .project.effects.find((effect) => effect.id === id)
      ?.parameters.find((parameter) => parameter.key === key)?.numericValue;
  await vi.waitFor(() => expect(port.onmidimessage).not.toBeNull());
  await settle();
  return { get, value, delay, reverb };
}

// The dial or fader of an effect's parameter, and the control around it that
// MIDI Map mode marks.
function dialOf(effectId: string, label: string) {
  const device = document
    .querySelector(`[data-fx-focus="${effectId}"]`)
    ?.closest(".fx-device-panel");
  const dial = [...(device?.querySelectorAll('[role="slider"]') ?? [])].find(
    (slider) =>
      slider.getAttribute("aria-labelledby") &&
      document.getElementById(slider.getAttribute("aria-labelledby") ?? "")
        ?.textContent === label,
  );
  expect(dial).toBeTruthy();
  return dial as HTMLElement;
}

const markOf = (dial: HTMLElement) =>
  dial.closest("[data-key-map]") as HTMLElement | null;

function firstKnob(effect: ReturnType<typeof createEffect>) {
  const parameter = knobParameters(effect)[0];
  expect(parameter).toBeTruthy();
  return parameter as NonNullable<typeof parameter>;
}

async function selectKnob(
  effect: ReturnType<typeof createEffect>,
  { key, label } = firstKnob(effect),
) {
  const dial = dialOf(effect.id, label);
  await page.elementLocator(dial).click();
  await vi.waitFor(() =>
    expect(markOf(dialOf(effect.id, label))?.dataset.keyMap).toBe("selected"),
  );
  return { key, label };
}

beforeAll(() => {
  Object.defineProperty(navigator, "requestMIDIAccess", {
    configurable: true,
    value: async () => access,
  });
});

beforeEach(() => {
  midiInputHub.setEnabled(true);
});

afterEach(() => {
  midiInputHub.chooseDevice(null);
  midiInputHub.setEnabled(false);
  computerKeyboardEntry.setEnabled(false);
  localStorage.removeItem(COMPUTER_KEYBOARD_STORAGE_KEY);
  localStorage.removeItem(MIDI_INPUT_STORAGE_KEY);
  ports.clear();
  access.onstatechange?.();
});

describe("MIDI Map CC mappings", { timeout: EDITOR_TEST_TIMEOUT }, () => {
  test("moving a control assigns it to the selected knob, on a device the app doesn't know", async () => {
    const port = plugIn("Homemade Box");
    const { get, value, delay } = await open(port);
    await toggleButton().click();
    const before = value(delay.id, firstKnob(delay).key);
    const { key, label } = await selectKnob(delay);

    // A whole sweep is one mapping and moves nothing yet.
    for (const sent of [10, 20, 30, 40]) {
      cc(port, 74, sent, 3);
    }
    await vi.waitFor(() =>
      expect(markOf(dialOf(delay.id, label))?.dataset.keyMapKey).toBe("CC 74"),
    );
    expect(value(delay.id, key)).toBe(before);
    const target = { kind: "number", effectId: delay.id, parameter: key };
    expect(get().project.midiMappings).toEqual([
      { controller: 74, channel: 3, target },
    ]);
    const saved = JSON.parse(
      JSON.stringify(projectToSession(get().project, { playheadQ: 0 })),
    );
    expect(sessionToProject(saved, []).midiMappings).toEqual([
      { controller: 74, channel: 3, target },
    ]);

    await toggleButton().click();
    await vi.waitFor(() => expect(markOf(dialOf(delay.id, label))).toBeNull());
    const { min, max } = firstKnob(delay);
    cc(port, 74, 127, 3);
    await vi.waitFor(() => expect(value(delay.id, key)).toBe(max));
    cc(port, 74, 0, 3);
    await vi.waitFor(() => expect(value(delay.id, key)).toBe(min));
    // Another channel's control is not the mapped one.
    cc(port, 74, 127, 4);
    await settle();
    expect(value(delay.id, key)).toBe(min);

    // The moves are one undo step, and the sweep that assigned was another.
    await settle(SETTLED_MS);
    await undo();
    await vi.waitFor(() => expect(value(delay.id, key)).toBe(before));
    expect(get().project.midiMappings).toHaveLength(1);
    await undo();
    await vi.waitFor(() => expect(get().project.midiMappings).toBeUndefined());
  });

  test("a control mapped by hand does that instead of its built-in role", async () => {
    const port = plugIn("Launchkey 49 MK3 MIDI");
    const { get, value, delay, reverb } = await open(port);
    const title = document
      .querySelector(`[data-fx-focus="${delay.id}"]`)
      ?.closest(".fx-device-panel")
      ?.querySelector(".fx-device-panel__title");
    await page
      .elementLocator(title as Element)
      .click({ position: { x: 60, y: 4 } });
    const delayKey = firstKnob(delay).key;
    const reverbKey = firstKnob(reverb).key;
    const delayBefore = value(delay.id, delayKey);
    const reverbBefore = value(reverb.id, reverbKey);

    await toggleButton().click();
    await selectKnob(reverb);
    cc(port, 21, 5);
    await vi.waitFor(() =>
      expect(get().project.midiMappings?.[0]?.controller).toBe(21),
    );
    // Assigning doesn't play the role either.
    expect(value(delay.id, delayKey)).toBe(delayBefore);
    await toggleButton().click();

    cc(port, 21, 127);
    await vi.waitFor(() =>
      expect(value(reverb.id, reverbKey)).not.toBe(reverbBefore),
    );
    expect(value(delay.id, delayKey)).toBe(delayBefore);

    // The next knob keeps its role.
    const second = knobParameters(delay)[1]?.key as string;
    const secondBefore = value(delay.id, second);
    cc(port, 22, 127);
    await vi.waitFor(() =>
      expect(value(delay.id, second)).not.toBe(secondBefore),
    );

    // With its effect gone, the control has its role back.
    await page
      .getByRole("button", { name: `Remove ${reverb.effectName}` })
      .click();
    await vi.waitFor(() => expect(get().project.midiMappings).toBeUndefined());
    const firstBefore = value(delay.id, delayKey);
    cc(port, 21, 127);
    await vi.waitFor(() =>
      expect(value(delay.id, delayKey)).not.toBe(firstBefore),
    );
  });

  test("a 14-bit control maps as one control and moves at full resolution (#1639)", async () => {
    const port = plugIn("Homemade Box");
    const { get, value, delay } = await open(port);
    await toggleButton().click();
    // High cut has the fine steps to show the extra resolution.
    const highCut = knobParameters(delay).find(
      (parameter) => parameter.key === "High cut",
    );
    const { key, label } = await selectKnob(delay, highCut);
    const before = value(delay.id, key);

    for (const [msb, lsb] of [
      [30, 90],
      [30, 100],
      [31, 0],
    ] as const) {
      cc(port, 1, msb, 2);
      cc(port, 33, lsb, 2);
    }
    await vi.waitFor(() =>
      expect(markOf(dialOf(delay.id, label))?.dataset.keyMapKey).toBe("CC 1"),
    );
    await settle();
    expect(get().project.midiMappings).toEqual([
      {
        controller: 1,
        channel: 2,
        target: { kind: "number", effectId: delay.id, parameter: key },
      },
    ]);
    expect(value(delay.id, key)).toBe(before);
    // One undo step takes back the whole sweep.
    await undo();
    await vi.waitFor(() => expect(get().project.midiMappings).toBeUndefined());
    cc(port, 1, 30, 2);
    cc(port, 33, 90, 2);
    await vi.waitFor(() =>
      expect(get().project.midiMappings?.[0]?.controller).toBe(1),
    );
    await toggleButton().click();

    // The fine part moves the knob between two steps of the coarse part.
    const moved = async (msb: number, lsb: number) => {
      cc(port, 1, msb, 2);
      cc(port, 33, lsb, 2);
      await settle();
      return value(delay.id, key) as number;
    };
    const low = await moved(64, 0);
    const middle = await moved(64, 64);
    const high = await moved(65, 0);
    expect(middle).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(middle);
    // Now it's known, so is a move of the fine part alone.
    cc(port, 33, 64, 2);
    await settle();
    expect(value(delay.id, key)).toBeCloseTo(await moved(65, 64), 10);
  });

  test("controllers 32 to 63 stay ordinary controls on a device using them that way (#1639)", async () => {
    const port = plugIn("Homemade Box");
    const { get, value, delay, reverb } = await open(port);
    await toggleButton().click();
    const { key: delayKey } = await selectKnob(delay);
    cc(port, 33, 10);
    await vi.waitFor(() =>
      expect(get().project.midiMappings?.[0]?.controller).toBe(33),
    );
    const { key: reverbKey } = await selectKnob(reverb);
    await settle();
    cc(port, 1, 10);
    await vi.waitFor(() =>
      expect(get().project.midiMappings?.[1]?.controller).toBe(1),
    );
    await toggleButton().click();

    const reverbBefore = value(reverb.id, reverbKey);
    cc(port, 33, 100);
    await vi.waitFor(() => expect(value(delay.id, delayKey)).not.toBe(0));
    await settle();
    const delayAfter = value(delay.id, delayKey);
    expect(value(reverb.id, reverbKey)).toBe(reverbBefore);

    cc(port, 1, 100);
    await vi.waitFor(() =>
      expect(value(reverb.id, reverbKey)).not.toBe(reverbBefore),
    );
    expect(value(delay.id, delayKey)).toBe(delayAfter);
  });

  test("selecting a knob doesn't move it, Delete removes its mapping, and only a CC maps it", async () => {
    const port = plugIn("Homemade Box");
    const { get, value, delay } = await open(port);
    const before = value(delay.id, firstKnob(delay).key);
    await toggleButton().click();
    const { key, label } = await selectKnob(delay);
    await page.elementLocator(dialOf(delay.id, label)).dblClick();
    expect(value(delay.id, key)).toBe(before);

    // A key doesn't map a knob.
    port.onmidimessage?.({ data: new Uint8Array([0x90, 60, 100]) });
    port.onmidimessage?.({ data: new Uint8Array([0x80, 60, 0]) });
    await settle();
    expect(get().project.midiMappings).toBeUndefined();

    cc(port, 10, 64);
    await vi.waitFor(() => expect(get().project.midiMappings).toHaveLength(1));
    await userEvent.keyboard("{Delete}");
    await vi.waitFor(() => expect(get().project.midiMappings).toBeUndefined());
    expect(markOf(dialOf(delay.id, label))?.dataset.keyMapKey).toBe(undefined);

    // Moving the same control again maps it again.
    cc(port, 10, 70);
    await vi.waitFor(() => expect(get().project.midiMappings).toHaveLength(1));
  });

  test("a CC doesn't map a selected button", async () => {
    const port = plugIn("Homemade Box");
    const { get } = await open(port);
    await toggleButton().click();
    await page.getByRole("button", { name: /(Bypass|Enable) Order/ }).click();
    cc(port, 10, 64);
    await settle();
    expect(get().project.midiMappings).toBeUndefined();
  });

  test("the Key Map leaves knobs alone", async () => {
    const port = plugIn("Homemade Box");
    computerKeyboardEntry.setEnabled(true);
    const { delay } = await open(port);
    await page.getByRole("button", { name: /^Key (on|map)$/ }).click();
    await expect
      .element(page.getByRole("button", { name: /(Bypass|Enable) Order/ }))
      .toHaveAttribute("data-key-map", "mappable");
    expect(markOf(dialOf(delay.id, firstKnob(delay).label))).toBeNull();
  });
});
