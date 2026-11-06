import { useState } from "react";
import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { createComputerKeyboardEntry } from "../midi-input/computer-keyboard.ts";
import { createMidiInputHub } from "../midi-input/input-hub.ts";
import { KeyInputControl, MidiInputControl } from "./InputModeControl";

const storage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
};

function Controls() {
  const [entry] = useState(() =>
    createComputerKeyboardEntry({ storage: storage() }),
  );
  const [hub] = useState(() =>
    createMidiInputHub({
      requestAccess: async () => undefined,
      loadMappings: async () => [],
      storage: storage(),
    }),
  );
  const [keyMapping, setKeyMapping] = useState(false);
  const [midiMapping, setMidiMapping] = useState(false);
  return (
    <>
      <KeyInputControl
        entry={entry}
        map={{
          active: keyMapping,
          toggle: () => setKeyMapping((active) => !active),
        }}
      />
      <MidiInputControl
        hub={hub}
        map={{
          active: midiMapping,
          toggle: () => setMidiMapping((active) => !active),
        }}
      />
    </>
  );
}

const button = (name: string) =>
  page.getByRole("button", { name, exact: true });
const group = (name: string) => page.getByRole("group", { name });

describe.each(["Key", "MIDI"])("%s input control", (name) => {
  test("the right segment goes on and map, the left goes off from both", async () => {
    await render(<Controls />);
    const input = group(`${name} input`);
    const off = button(`${name} off`);
    await expect.element(input).toHaveAttribute("data-mode", "off");
    await expect.element(off).toHaveAttribute("aria-pressed", "true");
    await expect
      .element(button(`${name} on`))
      .toHaveAttribute("aria-pressed", "false");

    await button(`${name} on`).click();
    await expect.element(input).toHaveAttribute("data-mode", "on");
    await expect.element(off).toHaveAttribute("aria-pressed", "false");
    await expect
      .element(button(`${name} on`))
      .toHaveAttribute("aria-pressed", "true");

    await button(`${name} on`).click();
    await expect.element(input).toHaveAttribute("data-mode", "map");
    await expect.element(button(`${name} map`)).toBeVisible();

    await button(`${name} map`).click();
    await expect.element(input).toHaveAttribute("data-mode", "on");

    await button(`${name} on`).click();
    await off.click();
    await expect.element(input).toHaveAttribute("data-mode", "off");
  });

  test("its segments are icons with no text", async () => {
    await render(<Controls />);
    const input = group(`${name} input`).element();
    expect(input.textContent).toBe("");
    expect(input.querySelectorAll("button svg")).toHaveLength(2);
  });
});
