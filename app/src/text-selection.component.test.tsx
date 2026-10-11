import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ProjectState } from "./app/types.ts";
import { FxEditor } from "./component-test/fx-editor.tsx";
import { EMPTY_PROJECT, withTextClip } from "./component-test/fx-projects.ts";
import { centerOf, mouse } from "./component-test/mouse.ts";
import { DesktopShell } from "./component-test/shells.tsx";
import {
  LayerHeader,
  type LayerHeaderContext,
} from "./components/timeline/LayerHeader";
import "./index.css";

// UI text can't be selected; only text fields can (#865). index.css sets
// this for the whole app, so these render representative UI: a layer header
// and the FX panel with a text clip's Text device.

const MOD = /Mac/.test(navigator.platform) ? "Meta" : "Control";
const noop = () => {};

function selectedText() {
  return window.getSelection()?.toString() ?? "";
}

const headerContext = {
  layerReorder: { gripProps: () => ({}) },
  renamingLaneId: undefined,
  setRenamingLaneId: noop,
  readOnly: false,
  openLayerMenu: noop,
  selectLaneFromLabel: noop,
  focusLaneLabel: noop,
  commitLayerRename: noop,
  setLayerFxEnabled: noop,
  setLayerHidden: noop,
  toggleRowCollapsed: noop,
  resizeRow: noop,
} as unknown as LayerHeaderContext;

async function renderEditor() {
  const added = withTextClip(EMPTY_PROJECT);
  const project: ProjectState = added.project;
  const lane = project.lanes[0];
  return render(
    <DesktopShell>
      <LayerHeader
        lane={lane}
        laneIndex={0}
        fxLaneId={lane.id}
        status={{ effectCount: 0, summary: "1 clip" }}
        height={56}
        expandedHeight={56}
        {...headerContext}
      />
      <FxEditor project={project} selection={{ clipId: added.clip.id }} />
    </DesktopShell>,
  );
}

describe("text selection", () => {
  test("double-clicking or dragging across UI text selects nothing", async () => {
    const screen = await renderEditor();
    // A layer's number, since double-clicking its name renames it (#940).
    const label = page.elementLocator(
      screen.container.querySelector(
        "[data-layer-header-id] .track-label__index",
      ) as Element,
    );
    await expect.element(label).toHaveTextContent("1");
    await userEvent.dblClick(label);
    expect(selectedText()).toBe("");

    const shell = screen.container.querySelector(".app-shell") as Element;
    const { box } = centerOf(shell);
    await mouse.move(box.left + 4, box.top + 4);
    await mouse.down();
    await mouse.move(box.right - 4, box.top + box.height / 2, { steps: 8 });
    await mouse.up();
    expect(selectedText()).toBe("");
  });

  test("select all outside a text field highlights no page text", async () => {
    await renderEditor();
    (document.activeElement as HTMLElement | null)?.blur();
    const range = document.createRange();
    range.selectNodeContents(document.body);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selectedText()).toBe("");
  });

  test("text fields stay selectable and other inputs don't", async () => {
    const screen = await render(
      <div className="fader">
        <input type="text" defaultValue="hello" data-field="text" />
        <input type="number" defaultValue="12" data-field="number" />
        <input defaultValue="name" data-field="untyped" />
        <textarea defaultValue="words" data-field="textarea" />
        <input type="checkbox" data-field="checkbox" />
        <input type="range" data-field="range" />
        <input type="color" data-field="color" />
      </div>,
    );
    const styles: Record<string, string> = Object.fromEntries(
      [...screen.container.querySelectorAll<HTMLElement>("[data-field]")].map(
        (field) => [
          field.dataset.field as string,
          getComputedStyle(field).userSelect,
        ],
      ),
    );
    styles.body = getComputedStyle(document.body).userSelect;
    expect(styles).toEqual({
      text: "text",
      number: "text",
      untyped: "text",
      textarea: "text",
      checkbox: "none",
      range: "none",
      color: "none",
      body: "none",
    });

    const field = screen.container.querySelector(
      "textarea",
    ) as HTMLTextAreaElement;
    field.value = "copy me";
    field.focus();
    await userEvent.keyboard(`{${MOD}>}a{/${MOD}}`);
    expect(field.value.slice(field.selectionStart, field.selectionEnd)).toBe(
      "copy me",
    );
  });
});
