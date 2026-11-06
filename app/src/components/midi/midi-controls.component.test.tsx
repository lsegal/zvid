import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { DEFAULT_INSTRUMENT, type MidiNote } from "../../midi-clip.ts";
import { defaultMidiTimeline } from "../../midi-clip-timeline.ts";
import {
  createMidiInputHub,
  type MidiAccessLike,
  type MidiInputPort,
} from "../../midi-input/input-hub.ts";
import {
  MIDI_INPUT_STORAGE_KEY,
  type PrefsStorage,
} from "../../midi-input/preferences.ts";
import { PianoRoll } from "./PianoRoll";

// Turning MIDI on and off and choosing its device in the piano roll's header
// (#1564), through simulated devices.

const MAPPED = {
  id: "test-keys",
  manufacturer: "Test",
  model: "Keys 49",
  portNames: ["test keys"],
  source: {
    url: "https://example.com",
    title: "Test",
    verification: "documented" as const,
  },
  controls: [],
};

function connectedPort(name: string): MidiInputPort {
  return { id: name, name, state: "connected", onmidimessage: null };
}

function memoryStorage(): PrefsStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

async function renderRoll({
  ports = [],
  requestAccess,
  storage = memoryStorage(),
  notes = [],
}: {
  ports?: MidiInputPort[];
  notes?: MidiNote[];
  requestAccess?: () => Promise<MidiAccessLike | undefined>;
  storage?: PrefsStorage;
}) {
  const inputs = new Map(ports.map((port) => [port.id, port]));
  const access = { inputs, onstatechange: null as (() => void) | null };
  const request = vi.fn(requestAccess ?? (async () => access));
  const auditions: number[] = [];
  const onSetNotes = vi.fn();
  const onToggleCollapsed = vi.fn();
  const hub = createMidiInputHub({
    requestAccess: request,
    loadMappings: async () => [MAPPED],
    storage,
  });
  await render(
    <PianoRoll
      collapsed={false}
      midiHub={hub}
      model={{
        spanId: "clip",
        label: "Bassline",
        accent: "#7ca1ff",
        notes,
        startQ: 0,
        trimStartQ: 0,
        lengthQ: 8,
        timeline: defaultMidiTimeline(8),
        instrument: DEFAULT_INSTRUMENT,
      }}
      onAudition={(pitch) => auditions.push(pitch)}
      onSetNotes={onSetNotes}
      onSetTimeline={() => {}}
      onToggleCollapsed={onToggleCollapsed}
    />,
  );
  return { access, inputs, request, auditions, onSetNotes, onToggleCollapsed };
}

const toggle = () => page.getByRole("button", { name: "MIDI input" });
const selector = () => page.getByRole("combobox", { name: "MIDI device" });
const shown = () => selector().element().textContent;

function press(port: MidiInputPort, pitch: number) {
  port.onmidimessage?.({ data: new Uint8Array([0x90, pitch, 100]) });
  port.onmidimessage?.({ data: new Uint8Array([0x80, pitch, 0]) });
}

async function turnOn() {
  await userEvent.click(toggle());
  await expect.element(toggle()).toHaveAttribute("aria-pressed", "true");
}

async function options() {
  await userEvent.click(selector());
  return page
    .getByRole("option")
    .elements()
    .map((option) => option.textContent);
}

test("MIDI starts off and asks for no permission until it's turned on", async () => {
  const port = connectedPort("Homemade Thing");
  const roll = await renderRoll({ ports: [port] });
  await expect.element(toggle()).toHaveAttribute("aria-pressed", "false");
  await expect.element(selector()).toBeDisabled();
  expect(roll.request).not.toHaveBeenCalled();
  expect(port.onmidimessage).toBeNull();

  await turnOn();
  expect(roll.request).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(port.onmidimessage).not.toBeNull());
  press(port, 60);
  expect(roll.auditions).toEqual([60]);

  await userEvent.click(toggle());
  await expect.element(toggle()).toHaveAttribute("aria-pressed", "false");
  expect(port.onmidimessage).toBeNull();
  expect(roll.auditions).toEqual([60]);
});

test("choosing a device limits input to it, and All devices takes every one", async () => {
  const mapped = connectedPort("Test Keys MIDI 1");
  const other = connectedPort("Homemade Thing");
  const roll = await renderRoll({ ports: [mapped, other] });
  await turnOn();
  await expect.poll(() => shown()).toContain("All devices");
  await expect
    .poll(options)
    .toEqual(["All devices", "Test Keys 49", "Homemade Thing"]);

  await userEvent.click(page.getByRole("option", { name: "Homemade Thing" }));
  await expect.poll(() => shown()).toContain("Homemade Thing");
  press(mapped, 60);
  press(other, 62);
  expect(roll.auditions).toEqual([62]);

  await userEvent.click(selector());
  await userEvent.click(page.getByRole("option", { name: "All devices" }));
  await expect.poll(() => shown()).toContain("All devices");
  press(mapped, 64);
  press(other, 65);
  expect(roll.auditions).toEqual([62, 64, 65]);
});

test("the list follows devices connecting and disconnecting", async () => {
  const first = connectedPort("Homemade Thing");
  const roll = await renderRoll({ ports: [] });
  await turnOn();
  await expect.poll(() => shown()).toContain("No MIDI devices");
  await expect.element(selector()).toBeDisabled();

  roll.inputs.set(first.id, first);
  roll.access.onstatechange?.();
  await expect.poll(() => shown()).toContain("All devices");
  await expect.poll(options).toEqual(["All devices", "Homemade Thing"]);
  await userEvent.keyboard("{Escape}");

  first.state = "disconnected";
  roll.access.onstatechange?.();
  await expect.poll(() => shown()).toContain("No MIDI devices");
});

test("permission denied and no Web MIDI each say so", async () => {
  await renderRoll({
    requestAccess: () =>
      Promise.reject(new DOMException("no", "NotAllowedError")),
  });
  await turnOn();
  await expect.poll(() => shown()).toContain("MIDI permission denied");
  await expect.element(selector()).toBeDisabled();
  await cleanup();

  await renderRoll({ requestAccess: async () => undefined });
  await turnOn();
  await expect.poll(() => shown()).toContain("MIDI unavailable");
  await expect.element(selector()).toBeDisabled();
});

test("the choice survives a reload, and a missing device says so and comes back", async () => {
  const storage = memoryStorage();
  const port = connectedPort("Homemade Thing");
  await renderRoll({ ports: [port], storage });
  await turnOn();
  await expect.poll(() => shown()).toContain("All devices");
  await userEvent.click(selector());
  await userEvent.click(page.getByRole("option", { name: "Homemade Thing" }));
  await expect.poll(() => shown()).toContain("Homemade Thing");
  expect(storage.getItem(MIDI_INPUT_STORAGE_KEY)).toContain("Homemade Thing");
  await cleanup();

  // Reloaded with the device unplugged and another connected.
  const other = connectedPort("Test Keys");
  const returned = connectedPort("Homemade Thing");
  const second = await renderRoll({ ports: [other], storage });
  await expect.element(toggle()).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => shown()).toContain("Not connected: Homemade Thing");
  expect(second.request).toHaveBeenCalledTimes(1);
  expect(other.onmidimessage).toBeNull();

  second.inputs.set(returned.id, returned);
  second.access.onstatechange?.();
  await expect.poll(() => shown()).not.toContain("Not connected");
  press(returned, 67);
  expect(second.auditions).toEqual([67]);
});

test("the controls keep the roll's keys and double-click to themselves", async () => {
  const roll = await renderRoll({
    ports: [connectedPort("Homemade Thing")],
    notes: [{ pitch: 60, start: 0, length: 1, velocity: 100 }],
  });
  await turnOn();
  await expect.poll(() => shown()).toContain("All devices");
  await userEvent.click(
    document.querySelector("[data-note-index='0']") as Element,
  );
  selector().element().focus();
  await userEvent.keyboard("{Delete}");
  expect(roll.onSetNotes).not.toHaveBeenCalled();
  await userEvent.dblClick(selector());
  expect(roll.onToggleCollapsed).not.toHaveBeenCalled();
  await userEvent.keyboard("{Escape}");
});
