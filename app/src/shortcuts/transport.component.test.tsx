import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { getShortcutLabels } from "../app/shortcut-labels.ts";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
} from "../component-test/editor.tsx";
import {
  createLoop,
  insertTextClip,
  readPlayheadQ,
  samplePlayheadQ,
} from "../component-test/editor-steps.ts";
import { center, click } from "../component-test/input.ts";
import { setViewport } from "../component-test/viewport.ts";
import { skipShortcut } from "./transport.ts";

// Ctrl/Cmd+Left and Right do what the outer skip buttons do, and
// Ctrl/Cmd+Space or Ctrl/Cmd-click on Play plays from the loop's in marker
// (#1107).

// Ctrl on Windows and Linux, Cmd on macOS, where Ctrl-click is a right
// click.
const MOD = getShortcutLabels().mac ? "Meta" : "Control";

const playButton = () => page.getByRole("button", { name: "Play timeline" });
const pauseButton = () => page.getByRole("button", { name: "Pause playback" });

async function press(
  button: ReturnType<typeof playButton>,
  modifiers: ("Meta" | "Control")[] = [],
) {
  await expect.element(button).toBeVisible();
  const { x, y } = center(button.element());
  await click(x, y, { modifiers });
}

// Runs `action` and returns the playhead once it has moved.
async function moveBy(action: () => Promise<unknown>) {
  const beforeQ = readPlayheadQ();
  await action();
  await expect.poll(readPlayheadQ).not.toBe(beforeQ);
  return readPlayheadQ();
}

// Clicks the ruler above the loop strip at `x`, parking the playhead there.
function parkPlayhead(x: number) {
  const ruler = (
    document.querySelector(".ruler-row__content") as HTMLElement
  ).getBoundingClientRect();
  return moveBy(() => click(x, ruler.y + 4));
}

// Every sample lies within the loop: playback started from its in marker.
function expectWithinLoop(
  samples: number[],
  loop: { startQ: number; endQ: number },
) {
  expect(samples.length).toBeGreaterThan(0);
  for (const q of samples) {
    expect(q).toBeGreaterThanOrEqual(loop.startQ - 0.1);
    expect(q).toBeLessThanOrEqual(loop.endQ + 0.1);
  }
}

// A text clip across the start of Layer 1, so there is something to play,
// and a loop over part of it.
async function renderWithLoop() {
  await renderEditor();
  const bounds = await insertTextClip();
  return createLoop(bounds.x + 60, bounds.x + 120);
}

describe("transport shortcuts", { timeout: EDITOR_TEST_TIMEOUT }, () => {
  beforeEach(async () => {
    await setViewport({ width: 1600, height: 1200 });
  });

  test("Ctrl/Cmd+Left and Right jump like the outer skip buttons", async () => {
    expect(skipShortcut.keys).toEqual(["Mod+ArrowLeft", "Mod+ArrowRight"]);
    const loop = await renderWithLoop();
    const insideX = loop.box.x + loop.box.width / 2;

    await parkPlayhead(insideX);
    expect(
      await moveBy(() => userEvent.keyboard(`{${MOD}>}{ArrowLeft}{/${MOD}}`)),
    ).toBeCloseTo(loop.startQ, 1);
    expect(
      await moveBy(() => userEvent.keyboard(`{${MOD}>}{ArrowLeft}{/${MOD}}`)),
    ).toBeCloseTo(0, 1);

    await parkPlayhead(insideX);
    expect(
      await moveBy(() => userEvent.keyboard(`{${MOD}>}{ArrowRight}{/${MOD}}`)),
    ).toBeCloseTo(loop.endQ, 1);
    const keyEndQ = await moveBy(() =>
      userEvent.keyboard(`{${MOD}>}{ArrowRight}{/${MOD}}`),
    );
    expect(keyEndQ).toBeGreaterThan(loop.endQ);

    // The buttons take the same route.
    await parkPlayhead(insideX);
    await moveBy(() =>
      press(
        page.getByRole("button", { name: "Jump to loop end", exact: true }),
      ),
    );
    expect(
      await moveBy(() =>
        press(
          page.getByRole("button", {
            name: "Jump to timeline end",
            exact: true,
          }),
        ),
      ),
    ).toBeCloseTo(keyEndQ, 3);

    // Plain arrows still step a frame.
    const beforeQ = readPlayheadQ();
    const steppedQ = await moveBy(() => userEvent.keyboard("{ArrowLeft}"));
    expect(beforeQ - steppedQ).toBeLessThan(0.2);
  });

  test("Ctrl/Cmd+Left in a text field does not move the playhead", async () => {
    await renderWithLoop();
    const clip = document.querySelector(
      '[data-timeline-lane-id="1"] .clip-card--text',
    ) as HTMLElement;
    await click(center(clip).x, center(clip).y);
    const field = page
      .getByRole("region", { name: "Text" })
      .getByRole("textbox", { name: "Text" });
    await expect.element(field).toBeVisible();
    await click(center(field.element()).x, center(field.element()).y);
    await expect.element(field).toHaveFocus();
    await userEvent.keyboard("{End}");
    const beforeQ = readPlayheadQ();

    await userEvent.keyboard(`{${MOD}>}{ArrowLeft}{/${MOD}}`);
    await userEvent.keyboard(`{${MOD}>}{ArrowRight}{/${MOD}}`);
    await expect.element(field).toHaveFocus();
    expect(readPlayheadQ()).toBe(beforeQ);
  });

  test("Ctrl+Space plays from the loop start", async () => {
    const loop = await renderWithLoop();
    // From 0, plain Play would start before the loop.
    await userEvent.keyboard("{Home}");
    await expect.poll(readPlayheadQ).toBe(0);

    await userEvent.keyboard("{Control>}{Space}{/Control}");
    await expect.element(pauseButton()).toBeVisible();
    expectWithinLoop(await samplePlayheadQ(500), loop);

    // While playing it restarts from the loop start rather than pausing.
    await userEvent.keyboard("{Control>}{Space}{/Control}");
    await expect.element(pauseButton()).toBeVisible();
    await press(pauseButton());
    await expect.element(playButton()).toBeVisible();
  });

  test("Ctrl/Cmd-click on Play plays from the loop start", async () => {
    const loop = await renderWithLoop();
    await parkPlayhead(loop.box.x + loop.box.width + 80);
    expect(readPlayheadQ()).toBeGreaterThan(loop.endQ);
    await expect
      .element(playButton())
      .toHaveAttribute(
        "title",
        expect.stringMatching(/click: play from loop start/),
      );

    await press(playButton(), [MOD]);
    await expect.element(pauseButton()).toBeVisible();
    expectWithinLoop(await samplePlayheadQ(500), loop);

    await press(pauseButton(), [MOD]);
    await expect.element(pauseButton()).toBeVisible();
    expectWithinLoop(await samplePlayheadQ(300), loop);
    await press(pauseButton());
    await expect.element(playButton()).toBeVisible();
  });
});
