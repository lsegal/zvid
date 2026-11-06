import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { patchProjectState } from "../app/session-project.ts";
import type { ProjectState } from "../app/types.ts";
import {
  EDITOR_TEST_TIMEOUT,
  type EditorState,
  renderEditor,
  sessionWithLayers,
} from "../component-test/editor.tsx";
import { mediaItem, withDroppedMedia } from "../component-test/fx-projects.ts";
import { undo } from "../component-test/input.ts";
import { DRUM_RACK_EFFECT_NAME } from "../fx/effects/drum-rack/drum-rack.ts";
import {
  createEffect,
  GLOBAL_EFFECT_TRACK_ID,
  sourceClipEffectTrackId,
} from "../fx-stack.ts";
import { addDefaultSynth } from "../midi-effects.ts";
import {
  type MidiAccessLike,
  type MidiInputPort,
  midiInputHub,
} from "../midi-input/input-hub.ts";
import { MIDI_INPUT_STORAGE_KEY } from "../midi-input/preferences.ts";
import { createMidiClip } from "../source-clip-edits.ts";

// The MIDI Map (#1571): mapping MIDI keys to effect buttons, and what those
// keys then do, through simulated devices. A new session's Global Order is the
// mapped device. The hub is the app's own, so one Web MIDI grant serves all.

const keysPort = connectedPort("Keys");
const padsPort = connectedPort("Pads");
const access: MidiAccessLike = {
  inputs: new Map([
    [keysPort.id, keysPort],
    [padsPort.id, padsPort],
  ]),
  onstatechange: null,
};

function connectedPort(name: string): MidiInputPort {
  return { id: name, name, state: "connected", onmidimessage: null };
}

const C4 = 60;
const D4 = 62;

function noteOn(port: MidiInputPort, note: number, channel = 1) {
  port.onmidimessage?.({
    data: new Uint8Array([0x90 + channel - 1, note, 100]),
  });
}

function noteOff(port: MidiInputPort, note: number, channel = 1) {
  port.onmidimessage?.({ data: new Uint8Array([0x80 + channel - 1, note, 0]) });
}

function tap(port: MidiInputPort, note: number, channel = 1) {
  noteOn(port, note, channel);
  noteOff(port, note, channel);
}

const toggleButton = () => page.getByRole("button", { name: /^MIDI: / });
const keyMapButton = () =>
  page.getByRole("button", { name: "Key Map", exact: true });
const orderPower = () =>
  page.getByRole("button", { name: /(Bypass|Enable) Order/ });

function orderOf(state: EditorState) {
  return state.project.effects.find((effect) => effect.effectName === "Order");
}

async function open(project: Partial<ProjectState> = sessionWithLayers(1)) {
  let state: EditorState | undefined;
  await renderEditor({
    project,
    onState: (next) => {
      state = next;
    },
  });
  await expect.element(orderPower()).toBeVisible();
  return () => state as EditorState;
}

// Maps the Order's power to `note`, and goes back to Use mode.
async function mapOrderPower(note = C4, channel = 1, port = keysPort) {
  await toggleButton().click();
  await orderPower().click();
  await vi.waitFor(() => expect(port.onmidimessage).not.toBeNull());
  tap(port, note, channel);
  await expect.element(orderPower()).toHaveAttribute("data-key-map-key");
  await toggleButton().click();
  await expect.element(orderPower()).not.toHaveAttribute("data-key-map");
}

beforeAll(() => {
  Object.defineProperty(navigator, "requestMIDIAccess", {
    configurable: true,
    value: async () => access,
  });
});

afterEach(() => {
  midiInputHub.chooseDevice(null);
  midiInputHub.setEnabled(true);
  localStorage.removeItem(MIDI_INPUT_STORAGE_KEY);
});

describe("MIDI Map", { timeout: EDITOR_TEST_TIMEOUT }, () => {
  test("starts in Use mode, and the toggle shows which mode is on", async () => {
    midiInputHub.setEnabled(true);
    await open();
    await expect.element(toggleButton()).toHaveTextContent("MIDI: Use");
    await expect
      .element(toggleButton())
      .toHaveAttribute("aria-pressed", "false");
    await expect.element(orderPower()).not.toHaveAttribute("data-key-map");

    await toggleButton().click();
    await expect.element(toggleButton()).toHaveTextContent("MIDI: Map");
    await expect
      .element(toggleButton())
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(orderPower())
      .toHaveAttribute("data-key-map", "mappable");
  });

  test("Map mode selects a button, and a MIDI key assigns without triggering", async () => {
    midiInputHub.setEnabled(true);
    const state = await open();
    await toggleButton().click();
    await orderPower().click();
    await expect
      .element(orderPower())
      .toHaveAttribute("data-key-map", "selected");
    expect(orderOf(state())?.enabled).toBe(true);

    await vi.waitFor(() => expect(keysPort.onmidimessage).not.toBeNull());
    tap(keysPort, C4, 3);
    await expect
      .element(orderPower())
      .toHaveAttribute("data-key-map-key", "C4");
    expect(orderOf(state())?.enabled).toBe(true);
    expect(state().project.midiMappings).toEqual([
      {
        note: C4,
        channel: 3,
        target: { kind: "power", effectId: expect.any(String) },
      },
    ]);
  });

  test("a mapped key bypasses like a click, and undo reverts it", async () => {
    midiInputHub.setEnabled(true);
    const state = await open();
    await mapOrderPower();

    tap(keysPort, C4);
    await expect.poll(() => orderOf(state())?.enabled).toBe(false);
    await expect
      .element(page.getByRole("button", { name: "Enable Order" }))
      .toBeVisible();
    // The same note on another channel is another key.
    tap(keysPort, C4, 10);
    expect(orderOf(state())?.enabled).toBe(false);

    await undo();
    await expect.poll(() => orderOf(state())?.enabled).toBe(true);
    tap(keysPort, C4);
    await expect.poll(() => orderOf(state())?.enabled).toBe(false);
  });

  test("a mapping can be changed and removed, and Escape cancels", async () => {
    midiInputHub.setEnabled(true);
    const state = await open();
    await toggleButton().click();
    await orderPower().click();
    await vi.waitFor(() => expect(keysPort.onmidimessage).not.toBeNull());
    tap(keysPort, C4);
    await expect
      .element(orderPower())
      .toHaveAttribute("data-key-map-key", "C4");

    tap(keysPort, D4);
    await expect
      .element(orderPower())
      .toHaveAttribute("data-key-map-key", "D4");
    expect(state().project.midiMappings).toHaveLength(1);

    await userEvent.keyboard("{Delete}");
    await expect.element(orderPower()).not.toHaveAttribute("data-key-map-key");
    expect(state().project.midiMappings).toBeUndefined();

    await userEvent.keyboard("{Escape}");
    await expect
      .element(orderPower())
      .toHaveAttribute("data-key-map", "mappable");
    tap(keysPort, C4);
    expect(state().project.midiMappings).toBeUndefined();
  });

  test("removing a device removes its mappings", async () => {
    midiInputHub.setEnabled(true);
    const state = await open();
    await mapOrderPower();
    await page.getByRole("button", { name: "Remove Order" }).click();
    await expect.poll(() => state().project.midiMappings).toBeUndefined();
  });

  test("mapped keys do nothing while MIDI is off or from another device", async () => {
    midiInputHub.setEnabled(true);
    const state = await open();
    await mapOrderPower();

    midiInputHub.chooseDevice({ id: padsPort.id, name: "Pads" });
    tap(keysPort, C4);
    expect(orderOf(state())?.enabled).toBe(true);
    tap(padsPort, C4);
    await expect.poll(() => orderOf(state())?.enabled).toBe(false);

    midiInputHub.setEnabled(false);
    expect(padsPort.onmidimessage).toBeNull();
    tap(padsPort, C4);
    expect(orderOf(state())?.enabled).toBe(false);
  });

  test("an MPE note triggers on every press, whichever channel it arrives on", async () => {
    midiInputHub.setEnabled(true);
    const mpePort = connectedPort("MPE");
    (access.inputs as Map<string, MidiInputPort>).set(mpePort.id, mpePort);
    access.onstatechange?.();
    const state = await open();
    await mapOrderPower(C4, 2, mpePort);

    for (const [channel, enabled] of [
      [3, false],
      [4, true],
      [9, false],
    ] as const) {
      tap(mpePort, C4, channel);
      await expect.poll(() => orderOf(state())?.enabled).toBe(enabled);
    }
    (access.inputs as Map<string, MidiInputPort>).delete(mpePort.id);
    access.onstatechange?.();
  });

  test("a mapped Drum Rack pad presses on Note On and releases on Note Off", async () => {
    midiInputHub.setEnabled(true);
    const dropped = withDroppedMedia(
      sessionWithLayers(1),
      mediaItem({ kind: "audio", durationSeconds: 2 }),
    );
    const patch = createMidiClip(
      dropped.project,
      dropped.span.sourceTrackId,
      16,
      16,
      "drums",
    );
    if (!patch) {
      throw new Error("No room for the MIDI clip");
    }
    const midi = patchProjectState(dropped.project, patch);
    const rack = createEffect(
      sourceClipEffectTrackId("drums"),
      DRUM_RACK_EFFECT_NAME,
      "rack",
    );
    await open(patchProjectState(midi, { effects: [...midi.effects, rack] }));
    document
      .querySelector<HTMLElement>('[data-source-span-id="drums"]')
      ?.click();
    const pad = page.getByRole("button", { name: /^Pad 1:/ });
    await expect.element(pad).toBeVisible();

    await toggleButton().click();
    await pad.click();
    await vi.waitFor(() => expect(keysPort.onmidimessage).not.toBeNull());
    tap(keysPort, D4);
    await expect.element(pad).toHaveAttribute("data-key-map-key", "D4");
    await expect.element(pad).not.toHaveAttribute("data-hit");
    await toggleButton().click();

    noteOn(keysPort, D4);
    await expect.element(pad).toHaveAttribute("data-hit");
    // It stays down past a click's flash, for as long as the key is.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect.element(pad).toHaveAttribute("data-hit");
    noteOff(keysPort, D4);
    await expect.element(pad).not.toHaveAttribute("data-hit");
  });

  test("in Use mode unmapped keys draw notes and mapped keys don't", async () => {
    midiInputHub.setEnabled(true);
    const base = sessionWithLayers(1);
    const effects = [
      ...base.effects,
      createEffect(GLOBAL_EFFECT_TRACK_ID, "Bloom", "bloom"),
      ...addDefaultSynth([], "bassline", "bass-synth"),
    ];
    let state: EditorState | undefined;
    await renderEditor({
      project: {
        ...base,
        effects,
        midiMappings: [
          { note: C4, channel: 1, target: { kind: "power", effectId: "bloom" } },
        ],
        sourceTracks: [
          ...base.sourceTracks,
          { id: "bass", name: "Bass", colorIndex: 2, recordingPaths: [] },
        ],
        sourceSpans: [
          ...base.sourceSpans,
          {
            id: "bassline",
            sourceTrackId: "bass",
            label: "Bassline",
            mediaPath: "",
            startQ: 0,
            durationSeconds: 60,
            trimStartSeconds: 0,
            notes: [],
            tint: "#1c2340",
            accent: "#7ca1ff",
          },
        ],
      },
      onState: (next) => {
        state = next;
      },
    });
    const current = () => state as EditorState;
    const notes = () =>
      current().project.sourceSpans.find((span) => span.id === "bassline")
        ?.notes;
    const clip = document.querySelector<HTMLElement>(
      '[data-source-span-id="bassline"]',
    );
    if (!clip) {
      throw new Error("missing the MIDI clip");
    }
    await userEvent.click(clip);
    await expect
      .element(page.getByRole("region", { name: "Bassline notes" }))
      .toBeVisible();
    await vi.waitFor(() => expect(keysPort.onmidimessage).not.toBeNull());
    await userEvent.click(page.getByRole("button", { name: "Play timeline" }));

    noteOn(keysPort, C4);
    await expect
      .poll(
        () =>
          current().project.effects.find((effect) => effect.id === "bloom")
            ?.enabled,
      )
      .toBe(false);
    expect(
      document.querySelector(`[data-piano-roll-held-note='${C4}']`),
    ).toBeNull();
    noteOff(keysPort, C4);

    noteOn(keysPort, D4);
    await expect
      .poll(() =>
        document.querySelector(`[data-piano-roll-held-note='${D4}']`),
      )
      .not.toBeNull();
    noteOff(keysPort, D4);
    await expect.poll(() => notes()?.map((note) => note.pitch)).toEqual([D4]);
    await userEvent.click(page.getByRole("button", { name: "Pause timeline" }));
  });

  test("Key Map and MIDI Map take turns with the buttons", async () => {
    midiInputHub.setEnabled(true);
    await open();
    await toggleButton().click();
    await keyMapButton().click();
    await expect.element(toggleButton()).toHaveTextContent("MIDI: Use");
    await expect
      .element(keyMapButton())
      .toHaveAttribute("aria-pressed", "true");

    await toggleButton().click();
    await expect.element(toggleButton()).toHaveTextContent("MIDI: Map");
    await expect
      .element(keyMapButton())
      .toHaveAttribute("aria-pressed", "false");
  });

  test("a button can have a computer key and a MIDI key", async () => {
    midiInputHub.setEnabled(true);
    const state = await open();
    await mapOrderPower();
    await keyMapButton().click();
    await orderPower().click();
    await userEvent.keyboard("q");
    await expect.element(orderPower()).toHaveAttribute("data-key-map-key", "Q");
    await keyMapButton().click();

    await userEvent.keyboard("q");
    await expect.poll(() => orderOf(state())?.enabled).toBe(false);
    tap(keysPort, C4);
    await expect.poll(() => orderOf(state())?.enabled).toBe(true);
  });
});
