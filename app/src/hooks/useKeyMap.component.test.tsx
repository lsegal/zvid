import {
  afterEach,
  beforeEach,
  describe,
  expect,
  onTestFinished,
  test,
} from "vitest";
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
import { pressMod, undo } from "../component-test/input.ts";
import {
  DRUM_RACK_EFFECT_NAME,
  DRUM_RACK_KEY,
} from "../fx/effects/drum-rack/drum-rack.ts";
import {
  createEffect,
  GLOBAL_EFFECT_TRACK_ID,
  sourceClipEffectTrackId,
} from "../fx-stack.ts";
import {
  COMPUTER_KEYBOARD_STORAGE_KEY,
  computerKeyboardEntry,
} from "../midi-input/computer-keyboard.ts";
import { createMidiClip } from "../source-clip-edits.ts";

// The Key Map (#1570): mapping keys to effect buttons, and what those keys
// then do. A new session's Global Order is the mapped device.

const toggleButton = () => page.getByRole("button", { name: /^Key (on|map)$/ });
const orderPower = () =>
  page.getByRole("button", { name: /(Bypass|Enable) Order/ });
const powerElement = () => orderPower().element();

function orderEnabled(state: EditorState) {
  return state.project.effects.find((effect) => effect.effectName === "Order")
    ?.enabled;
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

async function mapOrderPower(key: string) {
  await toggleButton().click();
  await orderPower().click();
  await userEvent.keyboard(key);
  await expect
    .poll(() => powerElement().getAttribute("data-key-map-key"))
    .not.toBeNull();
  await toggleButton().click();
  await expect
    .poll(() => powerElement().hasAttribute("data-key-map"))
    .toBe(false);
}

// The keydowns that get past the mapped keys to the rest of the app.
const reached: string[] = [];
const recordKey = (event: KeyboardEvent) => reached.push(event.key);

beforeEach(() => computerKeyboardEntry.setEnabled(true));

afterEach(() => {
  computerKeyboardEntry.setEnabled(false);
  localStorage.removeItem(COMPUTER_KEYBOARD_STORAGE_KEY);
  window.removeEventListener("keydown", recordKey);
  reached.length = 0;
  for (const input of document.querySelectorAll("input[data-test-field]")) {
    input.remove();
  }
});

describe("Key Map", { timeout: EDITOR_TEST_TIMEOUT }, () => {
  test("mapping mode marks buttons, and a click selects without activating", async () => {
    const state = await open();
    expect(powerElement().hasAttribute("data-key-map")).toBe(false);

    await toggleButton().click();
    await expect
      .element(page.getByRole("button", { name: "Key map" }))
      .toBeVisible();
    await expect
      .element(orderPower())
      .toHaveAttribute("data-key-map", "mappable");
    // The panel's own buttons aren't mappable.
    await expect
      .element(page.getByRole("button", { name: "Collapse Order" }))
      .not.toHaveAttribute("data-key-map");

    await orderPower().click();
    await expect
      .element(orderPower())
      .toHaveAttribute("data-key-map", "selected");
    expect(orderEnabled(state())).toBe(true);

    await userEvent.keyboard("q");
    await expect.element(orderPower()).toHaveAttribute("data-key-map-key", "Q");
    // While mapping, keys assign and trigger nothing.
    expect(orderEnabled(state())).toBe(true);
    expect(state().project.keyMappings).toEqual([
      { key: "q", target: { kind: "power", effectId: expect.any(String) } },
    ]);
  });

  test("with key input off, a mapped key does nothing", async () => {
    const state = await open();
    await mapOrderPower("q");
    await page.getByRole("button", { name: "Key off" }).click();
    await userEvent.keyboard("q");
    expect(orderEnabled(state())).toBe(true);
    await page.getByRole("button", { name: "Key on" }).click();
    await userEvent.keyboard("q");
    await expect.poll(() => orderEnabled(state())).toBe(false);
  });

  test("a mapped letter holds back while the piano roll plays from the keyboard", async () => {
    const state = await open();
    await mapOrderPower("a");
    const stopClaiming = computerKeyboardEntry.claimKeys();
    onTestFinished(stopClaiming);
    await userEvent.keyboard("a");
    expect(orderEnabled(state())).toBe(true);
    stopClaiming();
    await userEvent.keyboard("a");
    await expect.poll(() => orderEnabled(state())).toBe(false);
  });

  test("a mapped key bypasses like a click, once per press, and undo reverts it", async () => {
    const state = await open();
    await mapOrderPower("q");

    await userEvent.keyboard("{q>}");
    await expect.poll(() => orderEnabled(state())).toBe(false);
    await expect
      .element(page.getByRole("button", { name: "Enable Order" }))
      .toHaveAttribute("aria-pressed", "false");
    // Key repeat doesn't retrigger it.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "q", code: "KeyQ", repeat: true }),
    );
    expect(orderEnabled(state())).toBe(false);
    await userEvent.keyboard("{/q}");

    await undo();
    await expect.poll(() => orderEnabled(state())).toBe(true);
    // Undoing that left the mapping in place.
    await userEvent.keyboard("q");
    await expect.poll(() => orderEnabled(state())).toBe(false);
  });

  test("a mapping can be changed and removed, and Escape cancels", async () => {
    const state = await open();
    await toggleButton().click();
    await orderPower().click();
    await userEvent.keyboard("q");
    await expect.element(orderPower()).toHaveAttribute("data-key-map-key", "Q");

    await userEvent.keyboard("w");
    await expect.element(orderPower()).toHaveAttribute("data-key-map-key", "W");
    expect(state().project.keyMappings).toHaveLength(1);

    await userEvent.keyboard("{Delete}");
    await expect.element(orderPower()).not.toHaveAttribute("data-key-map-key");
    expect(state().project.keyMappings).toBeUndefined();

    await userEvent.keyboard("{Escape}");
    await expect
      .element(orderPower())
      .toHaveAttribute("data-key-map", "mappable");
    await userEvent.keyboard("e");
    expect(state().project.keyMappings).toBeUndefined();
  });

  test("Space, Escape and Ctrl/Cmd combinations can't be assigned", async () => {
    const state = await open();
    await toggleButton().click();
    await orderPower().click();
    await userEvent.keyboard(" ");
    await pressMod("k");
    await userEvent.keyboard("{Escape}");
    expect(state().project.keyMappings).toBeUndefined();
  });

  test("a mapped key takes priority over the global shortcuts", async () => {
    const state = await open();
    await mapOrderPower("{ArrowUp}");

    window.addEventListener("keydown", recordKey);
    await userEvent.keyboard("{ArrowUp}");
    await expect.poll(() => orderEnabled(state())).toBe(false);
    expect(reached).toEqual([]);
    // A key with no mapping reaches them.
    await userEvent.keyboard("{ArrowDown}");
    expect(reached).toEqual(["ArrowDown"]);
  });

  test("typing a mapped key in a text field types it and triggers nothing", async () => {
    const state = await open();
    await mapOrderPower("q");

    const input = document.createElement("input");
    input.dataset.testField = "";
    document.body.append(input);
    input.focus();
    await userEvent.keyboard("q");
    expect(input.value).toBe("q");
    expect(orderEnabled(state())).toBe(true);
  });

  test("removing a device removes its mappings, and its key goes back to what it did", async () => {
    const state = await open();
    await mapOrderPower("q");
    expect(state().project.keyMappings).toHaveLength(1);

    await page.getByRole("button", { name: "Remove Order" }).click();
    await expect.poll(() => state().project.keyMappings).toBeUndefined();

    window.addEventListener("keydown", recordKey);
    await userEvent.keyboard("q");
    expect(reached).toEqual(["q"]);

    // Undoing the removal brings the device and its key back.
    await undo();
    await expect.poll(() => state().project.keyMappings).toHaveLength(1);
    await userEvent.keyboard("q");
    await expect.poll(() => orderEnabled(state())).toBe(false);
  });

  test("a mapped key works while its device isn't shown", async () => {
    const state = await open();
    await mapOrderPower("q");

    // Collapsing the panel hides every device.
    document.querySelector<HTMLButtonElement>(".fx-panel__toggle")?.click();
    await expect.poll(() => orderPower().query()).toBeNull();

    await userEvent.keyboard("q");
    await expect.poll(() => orderEnabled(state())).toBe(false);
  });

  test("a mapped Drum Rack pad presses on key down and releases on key up", async () => {
    const dropped = withDroppedMedia(
      sessionWithLayers(1),
      mediaItem({ kind: "audio", durationSeconds: 2 }),
    );
    const trackId = dropped.span.sourceTrackId;
    const patch = createMidiClip(dropped.project, trackId, 16, 16, "drums");
    if (!patch) {
      throw new Error("No room for the MIDI clip");
    }
    const midi = patchProjectState(dropped.project, patch);
    const rack = {
      ...createEffect(
        sourceClipEffectTrackId("drums"),
        DRUM_RACK_EFFECT_NAME,
        "rack",
      ),
    };
    const state = await open(
      patchProjectState(midi, { effects: [...midi.effects, rack] }),
    );

    const span = document.querySelector<HTMLElement>(
      '[data-source-span-id="drums"]',
    );
    span?.click();
    const pad = page.getByRole("button", { name: /^Pad 1:/ });
    await expect.element(pad).toBeVisible();

    await toggleButton().click();
    await pad.click();
    // Selecting it plays nothing.
    await expect.element(pad).not.toHaveAttribute("data-hit");
    await userEvent.keyboard("p");
    await expect.element(pad).toHaveAttribute("data-key-map-key", "P");
    expect(state().project.keyMappings?.[0].target).toEqual({
      kind: "pad",
      effectId: "rack",
      parameter: DRUM_RACK_KEY,
      pad: 0,
    });
    await toggleButton().click();

    const pastBefore = state().canUndo;
    await userEvent.keyboard("{p>}");
    await expect.element(pad).toHaveAttribute("data-hit");
    // It stays down past a click's flash, for as long as the key is.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect.element(pad).toHaveAttribute("data-hit");
    await userEvent.keyboard("{/p}");
    await expect.element(pad).not.toHaveAttribute("data-hit");
    expect(state().canUndo).toBe(pastBefore);
  });

  test("a key can drive several buttons", async () => {
    const state = await open({
      ...sessionWithLayers(1),
      effects: [
        ...sessionWithLayers(1).effects,
        createEffect(GLOBAL_EFFECT_TRACK_ID, "Bloom", "bloom"),
      ],
    });
    await toggleButton().click();
    await orderPower().click();
    await userEvent.keyboard("q");
    await page.getByRole("button", { name: "Bypass Bloom" }).click();
    await userEvent.keyboard("q");
    await toggleButton().click();

    await userEvent.keyboard("q");
    await expect.poll(() => orderEnabled(state())).toBe(false);
    expect(
      state().project.effects.find((effect) => effect.id === "bloom")?.enabled,
    ).toBe(false);
  });
});
