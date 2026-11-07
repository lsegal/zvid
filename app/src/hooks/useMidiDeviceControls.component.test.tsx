import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { page } from "vitest/browser";
import { PREVIEW_VOLUME_STORAGE_KEY } from "../app/constants.ts";
import {
  EDITOR_TEST_TIMEOUT,
  type EditorState,
  renderEditor,
  sessionWithLayers,
  withTestPatternTrack,
} from "../component-test/editor.tsx";
import { undo } from "../component-test/input.ts";
import { GAIN_KEY, GAIN_MAX_DB } from "../fx/effects/gain/gain.ts";
import {
  createEffect,
  GLOBAL_EFFECT_TRACK_ID,
  sourceTrackEffectTrackId,
} from "../fx-stack.ts";
import { knobParameters } from "../midi-device-targets.ts";
import {
  type MidiAccessLike,
  type MidiInputPort,
  midiInputHub,
} from "../midi-input/input-hub.ts";
import { MIDI_INPUT_STORAGE_KEY } from "../midi-input/preferences.ts";

function assert(value: unknown): asserts value {
  expect(value).toBeTruthy();
}

// Built-in device mappings (#1615): a known device's knobs and faders act with
// no mapping made, through a simulated Launchkey 49 MK3, whose knobs send CC 21
// on, its first fader CC 41 on and its master fader CC 7 on channel 1.

const ports = new Map<string, MidiInputPort>();
const access: MidiAccessLike = { inputs: ports, onstatechange: null };
let port: MidiInputPort;

function cc(controller: number, value: number, channel = 1) {
  port.onmidimessage?.({
    data: new Uint8Array([0xb0 + channel - 1, controller, value]),
  });
}

async function open() {
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
  const parameterValue = (id: string, key: string) =>
    get()
      .project.effects.find((effect) => effect.id === id)
      ?.parameters.find((parameter) => parameter.key === key)?.numericValue;
  await vi.waitFor(() => expect(port.onmidimessage).not.toBeNull());
  await settle();
  return { get, parameterValue, delay, reverb };
}

const FIRST_KNOB = 21;
const FIRST_FADER = 41;
const MASTER_FADER = 7;
// Past the debounce that turns a run of moves into one undo step.
const SETTLED_MS = 500;

const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

// Clicks the device's title bar, which selects it.
async function select(effectId: string) {
  const title = document
    .querySelector(`[data-fx-focus="${effectId}"]`)
    ?.closest(".fx-device-panel")
    ?.querySelector(".fx-device-panel__title");
  assert(title);
  await page.elementLocator(title).click({ position: { x: 60, y: 4 } });
}

beforeAll(() => {
  Object.defineProperty(navigator, "requestMIDIAccess", {
    configurable: true,
    value: async () => access,
  });
});

beforeEach(() => {
  midiInputHub.setEnabled(true);
  port = {
    id: "launchkey",
    name: "Launchkey 49 MK3 MIDI",
    state: "connected",
    onmidimessage: null,
  };
  ports.set(port.id, port);
  access.onstatechange?.();
});

afterEach(() => {
  midiInputHub.chooseDevice(null);
  midiInputHub.setEnabled(false);
  localStorage.removeItem(MIDI_INPUT_STORAGE_KEY);
  localStorage.removeItem(PREVIEW_VOLUME_STORAGE_KEY);
  ports.clear();
  access.onstatechange?.();
});

describe("built-in MIDI device controls", {
  timeout: EDITOR_TEST_TIMEOUT,
}, () => {
  test("the first knob moves the selected effect's first parameter, with no mapping", async () => {
    const { parameterValue, delay } = await open();
    const [first] = knobParameters(delay);
    assert(first);
    cc(FIRST_KNOB, 100);
    await settle();
    expect(parameterValue(delay.id, first.key)).toBe(first.numericValue);

    await select(delay.id);
    cc(FIRST_KNOB, 127);
    await vi.waitFor(() =>
      expect(parameterValue(delay.id, first.key)).toBe(first.max),
    );
    cc(FIRST_KNOB, 0);
    await vi.waitFor(() =>
      expect(parameterValue(delay.id, first.key)).toBe(first.min),
    );
  });

  test("a knob sending relative steps steps its parameter (#1644)", async () => {
    const { parameterValue, delay } = await open();
    const [first] = knobParameters(delay);
    assert(first);
    await select(delay.id);
    for (let detent = 0; detent < 8; detent += 1) {
      cc(FIRST_KNOB, 127);
    }
    await vi.waitFor(() =>
      expect(parameterValue(delay.id, first.key)).toBeLessThan(
        first.numericValue as number,
      ),
    );
    expect(parameterValue(delay.id, first.key)).toBeGreaterThan(first.min);
  });

  test("selecting another effect retargets the knobs", async () => {
    const { parameterValue, delay, reverb } = await open();
    const [delayKnob] = knobParameters(delay);
    const [reverbKnob] = knobParameters(reverb);
    assert(delayKnob && reverbKnob);
    await select(delay.id);
    await select(reverb.id);
    cc(FIRST_KNOB, 100);
    cc(FIRST_KNOB, 127);
    await vi.waitFor(() =>
      expect(parameterValue(reverb.id, reverbKnob.key)).toBe(reverbKnob.max),
    );
    expect(parameterValue(delay.id, delayKnob.key)).toBe(
      delayKnob.numericValue,
    );
  });

  test("a run of moves is one undo step", async () => {
    const { parameterValue, delay } = await open();
    const [first] = knobParameters(delay);
    assert(first);
    await select(delay.id);
    for (const value of [10, 60, 127]) {
      cc(FIRST_KNOB, value);
    }
    await vi.waitFor(() =>
      expect(parameterValue(delay.id, first.key)).toBe(first.max),
    );
    await settle(SETTLED_MS);
    await undo();
    await vi.waitFor(() =>
      expect(parameterValue(delay.id, first.key)).toBe(first.numericValue),
    );
  });

  test("the master fader moves the volume slider", async () => {
    await open();
    const slider = page.getByRole("slider", { name: /volume/i });
    cc(MASTER_FADER, 0);
    await expect.element(slider).toHaveValue("0");
    cc(MASTER_FADER, 127);
    await expect.element(slider).toHaveValue("1");
  });

  test("a numbered fader moves its source track's Gain", async () => {
    const { get } = await open();
    const [track] = get().project.sourceTracks;
    assert(track);
    cc(FIRST_FADER, 100);
    cc(FIRST_FADER, 127);
    const gainOf = () =>
      get().project.effects.find(
        (effect) =>
          effect.trackId === sourceTrackEffectTrackId(track.id) &&
          effect.effectName === "Gain",
      );
    await vi.waitFor(() =>
      expect(
        gainOf()?.parameters.find((parameter) => parameter.key === GAIN_KEY)
          ?.numericValue,
      ).toBe(GAIN_MAX_DB),
    );
  });

  test("a key mapped by hand still does what it was mapped to", async () => {
    const { get } = await open();
    const orderPower = page.getByRole("button", {
      name: /(Bypass|Enable) Order/,
    });
    const midiButton = page.getByRole("button", { name: /^MIDI (on|map)$/ });
    await midiButton.click();
    await orderPower.click();
    port.onmidimessage?.({ data: new Uint8Array([0x90, 60, 100]) });
    await expect.element(orderPower).toHaveAttribute("data-key-map-key");
    await midiButton.click();
    await expect.element(orderPower).not.toHaveAttribute("data-key-map");
    port.onmidimessage?.({ data: new Uint8Array([0x80, 60, 0]) });
    const orderOn = () =>
      get().project.effects.find((effect) => effect.effectName === "Order")
        ?.enabled;
    const before = orderOn();
    port.onmidimessage?.({ data: new Uint8Array([0x90, 60, 100]) });
    await vi.waitFor(() => expect(orderOn()).toBe(!before));
  });
});
