import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  EDITOR_TEST_TIMEOUT,
  type EditorState,
  renderEditor,
  sessionWithLayers,
  withTestPatternTrack,
} from "../../component-test/editor.tsx";
import { setViewport } from "../../component-test/viewport.ts";
import { NameInput } from "../NameInput";
import { LayerHeader } from "./LayerHeader";
import { SourceTrackRow } from "./SourceTrackRow";

// Double-clicking a layer (LayerHeader) or source track (SourceTrackRow)
// name renames it inline in a NameInput, like Rename… in its menu (#940),
// in the editor harness that wires them as App does.
void [LayerHeader, SourceTrackRow, NameInput];

function layerName(id: string) {
  return page.elementLocator(
    document.querySelector(`[data-lane-label-id="${id}"]`) as HTMLElement,
  );
}

function layerNames() {
  return [
    ...document.querySelectorAll(
      "[data-layer-header-id] .track-label__select > span",
    ),
  ].map((name) => name.textContent);
}

function sourceTrackName() {
  return document.querySelector<HTMLElement>("[data-source-track-label-id]");
}

function sourceTrackNames() {
  return [
    ...document.querySelectorAll("[data-source-track-label-id] > span"),
  ].map((name) => name.textContent);
}

function fxPanelTitle() {
  return document.querySelector(".fx-panel__toggle")?.textContent;
}

function textbox(name: string) {
  return document.querySelector<HTMLInputElement>(
    `input[aria-label="${name}"]`,
  );
}

// Checks the field has focus with all of its text selected.
async function expectFocusedAndSelected(name: string) {
  await expect
    .poll(() => {
      const input = textbox(name);
      return (
        input !== null &&
        document.activeElement === input &&
        input.selectionStart === 0 &&
        input.selectionEnd === input.value.length
      );
    })
    .toBe(true);
}

describe("double-click to rename", { timeout: EDITOR_TEST_TIMEOUT }, () => {
  beforeEach(async () => {
    await setViewport({ width: 1600, height: 1200 });
  });

  test("double-clicking a layer name renames it inline", async () => {
    await renderEditor({ project: sessionWithLayers(3) });
    const input = page.getByRole("textbox", { name: "Layer name" });

    // The double-click selects the layer too, and puts the selected name in
    // the field.
    await userEvent.dblClick(layerName("2"));
    await expect.element(input).toHaveValue("Layer 2");
    await expectFocusedAndSelected("Layer name");
    expect(fxPanelTitle()).toBe("Layer 2 Effects");

    // Escape cancels.
    await userEvent.fill(input, "Ignored");
    await userEvent.keyboard("{Escape}");
    await expect.element(input).not.toBeInTheDocument();
    expect(layerNames()).toEqual(["Layer 1", "Layer 2", "Layer 3"]);

    // Enter saves.
    await userEvent.dblClick(layerName("2"));
    await userEvent.fill(input, "Drums");
    await userEvent.keyboard("{Enter}");
    await expect.poll(layerNames).toEqual(["Layer 1", "Drums", "Layer 3"]);

    // Leaving the field saves.
    await userEvent.dblClick(layerName("2"));
    await userEvent.fill(input, "Bass");
    await userEvent.click(
      page.elementLocator(
        document.querySelector(".fx-panel__toggle") as HTMLElement,
      ),
    );
    await expect.element(input).not.toBeInTheDocument();
    await expect.poll(layerNames).toEqual(["Layer 1", "Bass", "Layer 3"]);

    // A single click only selects.
    await userEvent.click(layerName("1"));
    await expect.poll(fxPanelTitle).toBe("Layer 1 Effects");
    expect(textbox("Layer name")).toBeNull();
  });

  test("double-clicking a source track name renames it inline", async () => {
    await renderEditor({
      project: withTestPatternTrack(sessionWithLayers(1)),
    });
    const input = page.getByRole("textbox", { name: "Source track name" });
    const name = () => page.elementLocator(sourceTrackName() as HTMLElement);

    await userEvent.dblClick(name());
    await expect.element(input).toHaveValue("test-pattern");
    await expectFocusedAndSelected("Source track name");
    expect(
      document.querySelector(".track-row--source[data-source-track-id]")
        ?.className,
    ).toMatch(/track-row--selected/);

    // Escape cancels and puts focus back on the name.
    await userEvent.fill(input, "Ignored");
    await userEvent.keyboard("{Escape}");
    await expect.element(input).not.toBeInTheDocument();
    expect(sourceTrackNames()).toEqual(["test-pattern"]);
    await expect.poll(() => document.activeElement).toBe(sourceTrackName());

    // Enter saves.
    await userEvent.dblClick(name());
    await userEvent.fill(input, "Wide shot");
    await userEvent.keyboard("{Enter}");
    await expect.poll(sourceTrackNames).toEqual(["Wide shot"]);

    // Leaving the field saves.
    await userEvent.dblClick(name());
    await userEvent.fill(input, "Close-up");
    await userEvent.click(layerName("1"));
    await expect.element(input).not.toBeInTheDocument();
    await expect.poll(sourceTrackNames).toEqual(["Close-up"]);
  });

  // A tab that opened the session read-only, as when another tab owns it.
  test("a read-only tab ignores a double-click on a name", async () => {
    let state: EditorState | undefined;
    await renderEditor({
      project: withTestPatternTrack(sessionWithLayers(1)),
      access: "read-only",
      onState: (next) => {
        state = next;
      },
    });
    await expect.poll(sourceTrackNames).toEqual(["test-pattern"]);

    await userEvent.dblClick(layerName("1"));
    await userEvent.dblClick(
      page.elementLocator(sourceTrackName() as HTMLElement),
    );
    expect(textbox("Layer name")).toBeNull();
    expect(textbox("Source track name")).toBeNull();
    // Nor does it ask to take the session over.
    expect(state?.isTakeOverPromptOpen).toBe(false);
  });
});
