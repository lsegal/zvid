import { describe, expect, test } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { patchProjectState } from "../app/session-project.ts";
import type { ProjectState } from "../app/types.ts";
import { EMPTY_PROJECT, withTextClip } from "../component-test/fx-projects.ts";
import { centerOf, mouse } from "../component-test/mouse.ts";
import {
  TextWorkspace,
  type TextWorkspaceProps,
} from "../component-test/text-workspace.tsx";
import { setViewport } from "../component-test/viewport.ts";
import { TEXT_EDITOR_TITLE } from "./PreviewTextEditor";
import "./PreviewTransformOverlay";

// Double-clicking a text clip in the preview (or Enter on the selected one,
// or a double-click on its timeline clip) types on it directly on the canvas.
// The FX panel follows along, and leaving the editor is one undo step.

const IS_MAC = /Mac/.test(navigator.platform);
const MOD = IS_MAC ? "Meta" : "Control";
const press = (keys: string) =>
  userEvent.keyboard(
    `{${MOD}>}${keys.startsWith("Shift+") ? `{Shift>}${keys.slice(6)}{/Shift}` : keys}{/${MOD}}`,
  );

const editor = () =>
  document.querySelector<HTMLElement>('[data-testid="preview-text-editor"]');
const input = () => editor()?.querySelector("textarea") ?? null;
// The editor's text area, which must be open.
function field() {
  const element = input();
  if (!element) {
    throw new Error("The text editor is not open");
  }
  return element;
}
const count = (selector: string) => document.querySelectorAll(selector).length;
const byTestId = (id: string) =>
  document.querySelector(`[data-testid="${id}"]`) as Element;
const cardBody = () =>
  document.querySelector(".clip-card--text .clip-card__body") as Element;
const fxText = () =>
  page
    .elementLocator(
      document.querySelector('section[aria-label="Text"]') as Element,
    )
    .getByRole("textbox", { name: "Text" });
const device = () =>
  page.elementLocator(
    document.querySelector('section[aria-label="Text"]') as Element,
  );
const fontSize = () => Number.parseFloat(getComputedStyle(field()).fontSize);

// The center of the letterboxed video: the overlay centers it in the
// monitor.
function videoCenter() {
  return centerOf(byTestId("preview-transform-overlay"));
}

async function dblclick({ x, y }: { x: number; y: number }) {
  await mouse.click(x, y, { clickCount: 2 });
}

async function expectFocusedEditor() {
  await expect.poll(() => document.activeElement === input()).toBe(true);
}

// A text clip on Layer 1, selected, with the playhead on it.
async function renderTextClip(project: ProjectState = EMPTY_PROJECT) {
  await setViewport({ width: 1600, height: 1200 });
  const added = withTextClip(project, { startQ: 0, durationQ: 8 });
  const props: TextWorkspaceProps = {
    project: added.project,
    selectedClipId: added.clip.id,
    playheadQ: 4,
  };
  const screen = await render(<TextWorkspace {...props} />);
  await expect.poll(() => count(".clip-card--selected")).toBe(1);
  await expect.element(fxText()).toBeVisible();
  return { screen, props };
}

describe("PreviewTextEditor", { timeout: 60_000 }, () => {
  test("typing on a text clip in the preview", async () => {
    await renderTextClip();
    const label = () =>
      document.querySelector(".clip-card--text strong")?.textContent;
    await expect.element(fxText()).toHaveValue("Text");
    expect(editor()).toBeNull();

    // Double-clicking the layer puts a caret on the canvas, with the default
    // text selected so typing replaces it.
    const center = videoCenter();
    await dblclick(center);
    await expectFocusedEditor();
    expect(input()?.value).toBe("Text");
    expect(input()?.title).toBe(TEXT_EDITOR_TITLE);
    expect(input()?.title).toMatch(/whole text clip/);
    // The resize handles and origin marker step aside so they don't cover the
    // editor.
    expect(count('[data-testid="preview-transform-origin"]')).toBe(0);
    expect(count("[data-transform-handle]")).toBe(0);

    // Typing updates the Text effect as it goes: the FX panel and the clip.
    await userEvent.keyboard("Hello{Enter}world");
    expect(input()?.value).toBe("Hello\nworld");
    await expect.element(fxText()).toHaveValue("Hello\nworld");
    await expect.poll(label).toBe("Hello");

    // Esc commits the edit, which undoes as one step.
    await userEvent.keyboard("{Escape}");
    await expect.poll(editor).toBeNull();
    expect(count('[data-testid="preview-transform-origin"]')).toBe(1);
    await press("z");
    await expect.element(fxText()).toHaveValue("Text");
    await press("Shift+z");
    await expect.element(fxText()).toHaveValue("Hello\nworld");

    // Enter on the selected layer edits it too. The style shortcuts restyle
    // the whole clip, and Ctrl/Cmd+Enter commits.
    await mouse.click(center.x, center.y);
    await userEvent.keyboard("{Enter}");
    await expectFocusedEditor();
    expect(input()?.value).toBe("Hello\nworld");
    const bold = device().getByRole("button", { name: "Bold" });
    await expect.element(bold).toHaveAttribute("aria-pressed", "false");
    await press("b");
    await expect.element(bold).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => getComputedStyle(field()).fontWeight).toBe("700");
    const before = fontSize();
    await press("Shift+>");
    await expect.poll(fontSize).toBeGreaterThan(before);
    await press("{Enter}");
    await expect.poll(editor).toBeNull();

    // Changes in the FX panel show in the editor straight away.
    await dblclick(center);
    await expectFocusedEditor();
    await userEvent.click(device().getByRole("button", { name: "Italic" }));
    expect(editor()).not.toBeNull();
    await expect.poll(() => getComputedStyle(field()).fontStyle).toBe("italic");

    // With Resize to fit on, the text shrinks as it grows.
    await userEvent.click(
      device()
        .getByRole("group", { name: "Resize to fit" })
        .getByRole("button", { name: "On" }),
    );
    await userEvent.click(page.elementLocator(field()));
    const fitted = fontSize();
    // Ctrl/Cmd+End: macOS moves to the end of the text with Cmd+Down.
    await press(IS_MAC ? "{ArrowDown}" : "{End}");
    await cdp().send("Input.insertText", {
      text: " and a great deal more text, enough to fill the whole box several times over, so that it has to shrink to fit".repeat(
        6,
      ),
    });
    await expect.poll(fontSize).toBeLessThan(fitted);

    // A click outside the box commits. Here it lands on the empty band
    // beside the video, which also deselects the clip, whose Text device
    // shows again once it is selected.
    const monitor = byTestId(
      "preview-transform-overlay",
    ).getBoundingClientRect();
    await mouse.click(monitor.left + 10, monitor.top + 5);
    await expect.poll(editor).toBeNull();
    await expect.poll(() => count(".clip-card--selected")).toBe(0);
    await userEvent.click(page.elementLocator(cardBody()));
    await expect
      .poll(() => (fxText().element() as HTMLTextAreaElement).value)
      .toMatch(/shrink to fit$/);

    // Double-clicking the clip on the timeline edits it too; an empty text
    // keeps the clip and shows a placeholder in the editor only.
    await userEvent.dblClick(page.elementLocator(cardBody()));
    await expectFocusedEditor();
    await press("a");
    await userEvent.keyboard("{Delete}");
    expect(input()?.value).toBe("");
    expect(input()?.placeholder).toBe("Text");
    await userEvent.keyboard("{Escape}");
    await expect.poll(editor).toBeNull();
    expect(count(".clip-card--text")).toBe(1);
    await expect.element(fxText()).toHaveValue("");
  });

  test("an IME composition is one undo step with the rest of the edit", async () => {
    await renderTextClip();
    await dblclick(videoCenter());
    await expectFocusedEditor();

    for (const text of ["n", "に", "にほ", "にほん"]) {
      await cdp().send("Input.imeSetComposition", {
        text,
        selectionStart: text.length,
        selectionEnd: text.length,
      });
    }
    await cdp().send("Input.insertText", { text: "日本" });
    await expect.poll(() => input()?.value).toBe("日本");
    await userEvent.keyboard("語");
    await expect.element(fxText()).toHaveValue("日本語");

    await userEvent.keyboard("{Escape}");
    await expect.poll(editor).toBeNull();
    await press("z");
    await expect.element(fxText()).toHaveValue("Text");
  });

  // Starting playback from the transport is kept in e2e/text-edit.spec.ts;
  // here playback starts and stops through the isPlaying state App passes.
  test("the transform handles step aside while editing text", async () => {
    // The press points below are placed for a portrait canvas, where the text
    // box fills the preview's height.
    const { screen, props } = await renderTextClip(
      patchProjectState(EMPTY_PROJECT, {
        canvasWidth: 1080,
        canvasHeight: 1920,
      }),
    );
    const center = videoCenter();

    // Whether the selected layer's resize handles, rotation handle and origin
    // marker are shown.
    const expectTransformHandles = async (shown: boolean) => {
      await expect
        .poll(() => count("[data-transform-handle]"))
        .toBe(shown ? 8 : 0);
      expect(count('[data-testid="preview-rotation-handle"]')).toBe(
        shown ? 1 : 0,
      );
      expect(count('[data-testid="preview-transform-origin"]')).toBe(
        shown ? 1 : 0,
      );
    };

    // The outline's edge lengths and rotation, in CSS pixels and degrees.
    const outlineShape = () => {
      const points = byTestId("preview-transform-outline").getAttribute(
        "points",
      );
      const [topLeft, topRight, , bottomLeft] = (points ?? "")
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(",").map(Number));
      return {
        width: Math.round(
          Math.hypot(topRight[0] - topLeft[0], topRight[1] - topLeft[1]),
        ),
        height: Math.round(
          Math.hypot(bottomLeft[0] - topLeft[0], bottomLeft[1] - topLeft[1]),
        ),
        rotation: Math.round(
          (Math.atan2(topRight[1] - topLeft[1], topRight[0] - topLeft[0]) *
            180) /
            Math.PI,
        ),
      };
    };

    await mouse.click(center.x, center.y);
    await expectTransformHandles(true);
    const shape = outlineShape();

    // Each way out of the editor brings the handles back: Esc,
    // Ctrl/Cmd+Enter, a click outside and starting playback.
    const exits: [string, () => Promise<void>][] = [
      ["Escape", () => userEvent.keyboard("{Escape}")],
      ["Ctrl/Cmd+Enter", () => press("{Enter}")],
      [
        "a click outside",
        async () => {
          const outside = centerOf(byTestId("outside"));
          await mouse.click(outside.x, outside.y);
        },
      ],
      [
        "playback",
        async () => {
          await screen.rerender(<TextWorkspace {...props} isPlaying />);
          await expect.poll(editor).toBeNull();
          await screen.rerender(<TextWorkspace {...props} isPlaying={false} />);
        },
      ],
    ];
    for (const [name, exit] of exits) {
      await dblclick(center);
      await expectFocusedEditor();
      await expectTransformHandles(false);
      await exit();
      await expect.poll(editor, { message: name }).toBeNull();
      await expectTransformHandles(true);
    }

    // While editing, dragging from where a resize handle or a corner's rotate
    // zone would be doesn't resize or rotate the layer. The press still ends
    // the edit, and moves the layer or clears the selection as usual. The zone
    // is beside the corner, as the text box fills the portrait preview's
    // height.
    const pressPoints: [string, () => { x: number; y: number }][] = [
      [
        "rotate zone",
        () => {
          const corner = centerOf(byTestId("preview-transform-handle-se"));
          return { x: corner.x + 12, y: corner.y - 8 };
        },
      ],
      [
        "resize handle",
        () => {
          // The handle straddles the box's edge; press its outer half so the
          // press lands beside the text box, not inside the editor.
          const handle = centerOf(byTestId("preview-transform-handle-e"));
          return { x: handle.x + 3, y: handle.y };
        },
      ],
    ];
    for (const [name, pressPoint] of pressPoints) {
      const from = pressPoint();
      await dblclick(center);
      await expectFocusedEditor();
      await expectTransformHandles(false);
      await mouse.move(from.x, from.y);
      await mouse.down();
      await mouse.move(from.x - 40, from.y + 30, { steps: 5 });
      await mouse.up();
      await expect.poll(editor, { message: name }).toBeNull();
      await userEvent.click(page.elementLocator(cardBody()));
      await expectTransformHandles(true);
      expect(outlineShape(), name).toEqual(shape);
    }
  });
});
