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
import { createEffect, GLOBAL_EFFECT_TRACK_ID } from "../fx-stack.ts";
import { knobParameters } from "../midi-device-targets.ts";
import {
  type MidiAccessLike,
  type MidiInputPort,
  midiInputHub,
} from "../midi-input/input-hub.ts";
import { MIDI_INPUT_STORAGE_KEY } from "../midi-input/preferences.ts";
import { projectToSession } from "../session-save.ts";

// Pitch bend faders mapped by hand in MIDI Map mode (#1638), through a simulated
// device the app doesn't know and a simulated X-Touch One, whose fader sends
// pitch bend on channel 1 with a built-in role.

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

const send = (port: MidiInputPort, ...data: number[]) =>
  port.onmidimessage?.({ data: new Uint8Array(data) });
const bend = (port: MidiInputPort, channel: number, value: number) =>
  send(port, 0xe0 + channel - 1, value & 0x7f, value >> 7);
const noteOn = (port: MidiInputPort, note: number, channel = 1) =>
  send(port, 0x90 + channel - 1, note, 100);
const noteOff = (port: MidiInputPort, note: number, channel = 1) =>
  send(port, 0x80 + channel - 1, note, 0);

const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
const toggleButton = () =>
  page.getByRole("button", { name: /^MIDI (on|map)$/ });

async function open(port: MidiInputPort) {
  let state: EditorState | undefined;
  const delay = createEffect(GLOBAL_EFFECT_TRACK_ID, "Delay");
  const session = sessionWithLayers(1);
  await renderEditor({
    project: withTestPatternTrack({
      ...session,
      effects: [...(session.effects ?? []), delay],
    }),
    onState: (next) => {
      state = next;
    },
  });
  const get = () => state as EditorState;
  const knob = knobParameters(delay)[0] as NonNullable<
    ReturnType<typeof knobParameters>[number]
  >;
  const value = () =>
    get()
      .project.effects.find((effect) => effect.id === delay.id)
      ?.parameters.find((parameter) => parameter.key === knob.key)
      ?.numericValue;
  const dial = () => {
    const device = document
      .querySelector(`[data-fx-focus="${delay.id}"]`)
      ?.closest(".fx-device-panel");
    const found = [...(device?.querySelectorAll('[role="slider"]') ?? [])].find(
      (slider) =>
        document.getElementById(slider.getAttribute("aria-labelledby") ?? "")
          ?.textContent === knob.label,
    );
    expect(found).toBeTruthy();
    return found as HTMLElement;
  };
  const mark = () => dial().closest("[data-key-map]") as HTMLElement | null;
  const target = { kind: "number", effectId: delay.id, parameter: knob.key };
  const select = async () => {
    await toggleButton().click();
    await page.elementLocator(dial()).click();
    await vi.waitFor(() => expect(mark()?.dataset.keyMap).toBe("selected"));
  };
  await vi.waitFor(() => expect(port.onmidimessage).not.toBeNull());
  await settle();
  return { get, value, mark, knob, target, select, delay };
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
  localStorage.removeItem(MIDI_INPUT_STORAGE_KEY);
  ports.clear();
  access.onstatechange?.();
});

describe("MIDI Map pitch bend mappings", {
  timeout: EDITOR_TEST_TIMEOUT,
}, () => {
  test("moving a fader assigns it, on a device the app doesn't know", async () => {
    const port = plugIn("Homemade Box");
    const { get, value, mark, knob, target, select } = await open(port);
    const before = value();
    await select();

    // A whole sweep is one mapping and moves nothing yet.
    for (const sent of [9000, 10000, 11000]) {
      bend(port, 3, sent);
    }
    await vi.waitFor(() => expect(mark()?.dataset.keyMapKey).toBe("PB 3"));
    expect(value()).toBe(before);
    const saved = [{ pitchBend: true, channel: 3, target }];
    expect(get().project.midiMappings).toEqual(saved);
    const session = JSON.parse(
      JSON.stringify(projectToSession(get().project, { playheadQ: 0 })),
    );
    expect(sessionToProject(session, []).midiMappings).toEqual(saved);

    await toggleButton().click();
    await vi.waitFor(() => expect(mark()).toBeNull());
    bend(port, 3, 16383);
    await vi.waitFor(() => expect(value()).toBe(knob.max));
    bend(port, 3, 0);
    await vi.waitFor(() => expect(value()).toBe(knob.min));
    // Another channel's fader is not the mapped one.
    bend(port, 4, 16383);
    await settle();
    expect(value()).toBe(knob.min);
  });

  test("a fader mapped by hand does that instead of its built-in role", async () => {
    const port = plugIn("X-Touch One");
    const { get, value, knob, select, delay } = await open(port);
    await select();
    bend(port, 1, 9000);
    await vi.waitFor(() =>
      expect(get().project.midiMappings?.[0]?.pitchBend).toBe(true),
    );
    await toggleButton().click();
    const volume = page.getByRole("slider", { name: /volume/i });
    const volumeOf = () => (volume.element() as HTMLInputElement).value;
    const volumeBefore = volumeOf();

    bend(port, 1, 16383);
    await vi.waitFor(() => expect(value()).toBe(knob.max));
    expect(volumeOf()).toBe(volumeBefore);

    // With its effect gone, the mapping goes too.
    await page
      .getByRole("button", { name: `Remove ${delay.effectName}` })
      .click();
    await vi.waitFor(() => expect(get().project.midiMappings).toBeUndefined());
    // The fader has its role back.
    bend(port, 1, 0);
    await expect.element(volume).toHaveValue("0");
  });

  test("a pitch wheel played with a key doesn't map, nor does its spring back", async () => {
    const port = plugIn("Homemade Keyboard");
    const { get, select } = await open(port);
    await select();

    noteOn(port, 60);
    bend(port, 1, 12000);
    await settle();
    expect(get().project.midiMappings).toBeUndefined();

    noteOff(port, 60);
    bend(port, 1, 10000);
    bend(port, 1, 8192);
    await settle();
    expect(get().project.midiMappings).toBeUndefined();

    // A wheel at rest says nothing either.
    bend(port, 1, 8192);
    await settle();
    expect(get().project.midiMappings).toBeUndefined();

    // Back at center, a move with no key down is a deliberate one.
    bend(port, 1, 9000);
    await vi.waitFor(() =>
      expect(get().project.midiMappings?.[0]?.pitchBend).toBe(true),
    );
  });

  test("a bend from a device playing MPE doesn't map", async () => {
    const port = plugIn("Homemade Seaboard");
    const { get, select } = await open(port);
    await select();
    noteOn(port, 60, 2);
    noteOn(port, 64, 3);
    noteOff(port, 60, 2);
    noteOff(port, 64, 3);
    // The bend each note starts with comes before its Note On.
    bend(port, 4, 9000);
    await settle();
    expect(get().project.midiMappings).toBeUndefined();
  });

  test("touching a Mackie fader doesn't count as holding a key", async () => {
    const port = plugIn("Homemade Box");
    const { get, mark, select } = await open(port);
    await select();

    // Fader 2's touch is a key as far as fader 3 knows, which keeps it safe.
    noteOn(port, 105);
    bend(port, 3, 9000);
    await settle();
    expect(get().project.midiMappings).toBeUndefined();
    noteOff(port, 105);
    // Past the rest that follows a bend ignored with a key down.
    await settle(1100);

    // Its own touch doesn't stop it.
    noteOn(port, 106);
    bend(port, 3, 9000);
    await vi.waitFor(() => expect(mark()?.dataset.keyMapKey).toBe("PB 3"));
    noteOff(port, 106);
  });

  test("Delete removes the mapping, and moving the fader maps it again", async () => {
    const port = plugIn("Homemade Box");
    const { get, select } = await open(port);
    await select();
    bend(port, 2, 9000);
    await vi.waitFor(() => expect(get().project.midiMappings).toHaveLength(1));
    await userEvent.keyboard("{Delete}");
    await vi.waitFor(() => expect(get().project.midiMappings).toBeUndefined());
    bend(port, 2, 9100);
    await vi.waitFor(() => expect(get().project.midiMappings).toHaveLength(1));
  });
});
