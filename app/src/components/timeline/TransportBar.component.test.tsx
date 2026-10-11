import { beforeEach, describe, expect, test } from "vitest";
import { cdp, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  BASE_QUARTER_PX,
  PREVIEW_VOLUME_STORAGE_KEY,
} from "../../app/constants.ts";
import { setViewport } from "../../component-test/viewport.ts";
import { createPlayheadSignal } from "../../playhead-signal.ts";
import { TimelineToolbar } from "./TimelineToolbar";
import { TransportBar } from "./TransportBar";
import { TransportHarness, textClip } from "./transport-test-harness.tsx";

// The harness renders TransportBar, under TimelineToolbar, as App does;
// importing them here makes `vitest --changed` select this file when
// either changes.
void TransportBar;
void TimelineToolbar;

beforeEach(() => {
  localStorage.removeItem(PREVIEW_VOLUME_STORAGE_KEY);
});

function box(element: Element | null) {
  if (!element) throw new Error("element is not rendered");
  return element.getBoundingClientRect();
}

function query(selector: string) {
  return box(document.querySelector(selector));
}

// The session in transport-skip's e2e: a text clip from 20px to 400px at
// 100% zoom, and a loop from 60px to 120px in.
const CLIP = textClip(20 / BASE_QUARTER_PX, 380 / BASE_QUARTER_PX / 2);
const LOOP = { startQ: 60 / BASE_QUARTER_PX, endQ: 120 / BASE_QUARTER_PX };

describe("TransportBar skip buttons", () => {
  // The outer skip buttons jump to the loop's markers and the timeline's
  // ends, labeled with where they go, and playback carries on from there
  // (#1091).

  // Where the playhead is: at the loop's in or out marker, at the timeline
  // start, or past the loop, within two pixels at 100% zoom.
  function playheadAt(playheadQ: number, loop = LOOP) {
    const near = (a: number, b: number) =>
      Math.abs(a - b) * BASE_QUARTER_PX <= 2;
    if (near(playheadQ, loop.startQ)) return "loop start";
    if (near(playheadQ, loop.endQ)) return "loop end";
    if (near(playheadQ, 0)) return "timeline start";
    return playheadQ > loop.endQ ? "after loop" : "elsewhere";
  }

  async function renderSkip() {
    const signal = createPlayheadSignal();
    const screen = await render(
      <TransportHarness clips={[CLIP]} loop={LOOP} playheadSignal={signal} />,
    );
    const back = screen.container.querySelector(
      ".transport-button--skip-start",
    ) as HTMLButtonElement;
    const forward = screen.container.querySelector(
      ".transport-button--skip-end",
    ) as HTMLButtonElement;
    const skip = async (
      button: HTMLButtonElement,
      label: string,
      expected: string,
    ) => {
      expect(button.getAttribute("aria-label")).toBe(label);
      // The title adds the Ctrl/Cmd+arrow shortcut (#1107).
      expect(button.title).toMatch(
        new RegExp(`^${label} \\((Ctrl|Cmd)\\+(Left|Right)\\)$`),
      );
      await userEvent.click(button);
      await expect.poll(() => playheadAt(signal.get())).toBe(expected);
    };
    return { screen, signal, back, forward, skip };
  }

  test("jumps between the loop's markers and the timeline's ends", async () => {
    const { screen, signal, back, forward, skip } = await renderSkip();
    expect(playheadAt(signal.get())).toBe("timeline start");

    // Forward: before the loop, to its start, then its end, then the end.
    await skip(forward, "Jump to loop start", "loop start");
    await skip(forward, "Jump to loop end", "loop end");
    await skip(forward, "Jump to timeline end", "after loop");
    await expect
      .element(forward)
      .toHaveAttribute("aria-label", "Jump to timeline end");

    // Back: after the loop, to its end, then from inside to its start, then
    // the timeline start.
    await skip(back, "Jump to loop end", "loop end");
    await skip(back, "Jump to loop start", "loop start");
    await skip(back, "Jump to timeline start", "timeline start");
    await expect
      .element(back)
      .toHaveAttribute("aria-label", "Jump to timeline start");

    // Without a loop, they go to the timeline's ends.
    await screen.getByRole("button", { name: "Remove loop" }).click();
    await expect
      .element(forward)
      .toHaveAttribute("aria-label", "Jump to timeline end");
    await userEvent.click(forward);
    await expect
      .poll(() => signal.get() * BASE_QUARTER_PX)
      .toBeGreaterThan(200);
    await skip(back, "Jump to timeline start", "timeline start");
  });

  test("playback carries on from where they jump", async () => {
    const { screen, signal, forward } = await renderSkip();
    await screen.getByRole("button", { name: "Play timeline" }).click();
    const pause = screen.getByRole("button", { name: "Pause playback" });
    await expect.element(pause).toBeVisible();

    // Once the playhead is inside the loop, Forward jumps to its out marker
    // and playback runs on past it.
    await expect
      .element(forward)
      .toHaveAttribute("aria-label", "Jump to loop end");
    await userEvent.click(forward);
    await expect.element(pause).toBeVisible();
    await expect
      .poll(() => (signal.get() - LOOP.endQ) * BASE_QUARTER_PX)
      .toBeGreaterThan(10);
    await expect.element(pause).toBeVisible();
    await pause.click();
  });
});

describe("TransportBar half-bar buttons", () => {
  // The half-bar buttons land on the snap grid when snapping is on, and
  // move exactly half a bar when it's off (#1092). At 100% zoom the grid is
  // in eighth notes, and a 4/4 bar is four quarters.
  const BAR_QUARTERS = 4;
  const GRID_QUARTERS = 0.5;

  // Runs `action` and returns the playhead, in quarters, once it has moved.
  async function moveBy(
    signal: ReturnType<typeof createPlayheadSignal>,
    action: () => Promise<unknown>,
  ) {
    const beforeQ = signal.get();
    await action();
    await expect.poll(() => signal.get()).not.toBe(beforeQ);
    return signal.get();
  }

  // Five frames on, with Shift+Right.
  const stepFiveFrames = () =>
    userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");

  function expectOnGrid(valueQ: number) {
    const steps = valueQ / GRID_QUARTERS;
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(0.05);
  }

  async function renderHalfBar() {
    await setViewport({ width: 1600, height: 1200 });
    const signal = createPlayheadSignal();
    const screen = await render(<TransportHarness playheadSignal={signal} />);
    expect(signal.get()).toBe(0);
    const button = (name: string) =>
      screen.getByRole("button", { name, exact: true });
    return { signal, button };
  }

  test("with snap on, they land an off-grid playhead on the grid", async () => {
    const { signal, button } = await renderHalfBar();
    await expect
      .element(button("Snap On"))
      .toHaveAttribute("aria-pressed", "true");

    // Five frames in puts the playhead between grid lines.
    const offGridQ = await moveBy(signal, stepFiveFrames);
    expect(offGridQ).toBeGreaterThan(0.05);
    expect(offGridQ % GRID_QUARTERS).toBeGreaterThan(0.05);

    const forwardQ = await moveBy(signal, () =>
      button("Jump forward half a bar").click(),
    );
    expectOnGrid(forwardQ);
    expect(
      Math.abs(forwardQ - (offGridQ + BAR_QUARTERS / 2)),
    ).toBeLessThanOrEqual(GRID_QUARTERS / 2 + 0.05);

    const nextOffGridQ = await moveBy(signal, stepFiveFrames);
    const backQ = await moveBy(signal, () =>
      button("Jump back half a bar").click(),
    );
    expectOnGrid(backQ);
    expect(
      Math.abs(backQ - (nextOffGridQ - BAR_QUARTERS / 2)),
    ).toBeLessThanOrEqual(GRID_QUARTERS / 2 + 0.05);

    // On the grid, a jump is exactly half a bar.
    expect(
      await moveBy(signal, () => button("Jump forward half a bar").click()),
    ).toBeCloseTo(backQ + BAR_QUARTERS / 2, 1);
  });

  test("with snap off, they move exactly half a bar", async () => {
    const { signal, button } = await renderHalfBar();
    await button("Snap On").click();
    await expect
      .element(button("Snap Off"))
      .toHaveAttribute("aria-pressed", "false");

    const offGridQ = await moveBy(signal, stepFiveFrames);
    expect(offGridQ % GRID_QUARTERS).toBeGreaterThan(0.05);

    const forwardQ = await moveBy(signal, () =>
      button("Jump forward half a bar").click(),
    );
    expect(forwardQ).toBeCloseTo(offGridQ + BAR_QUARTERS / 2, 1);

    expect(
      await moveBy(signal, () => button("Jump back half a bar").click()),
    ).toBeCloseTo(offGridQ, 1);
  });
});

describe("TransportBar layout and preview volume", () => {
  // The transport bar centers its transport buttons, with the zoom control
  // on the left and the preview volume on the right. The volume is a
  // per-viewer preference that plays the audio mix quieter.

  function renderBar() {
    return render(<TransportHarness playheadSignal={createPlayheadSignal()} />);
  }

  test("the transport buttons sit in the middle of the bar, volume on the right", async () => {
    await setViewport({ width: 1440, height: 900 });
    await renderBar();

    const barBox = query(".transport-bar");
    const cluster = query(".transport-cluster");
    const zoom = query(".zoom-control");
    const volume = query(".volume-control");
    const barCenter = barBox.x + barBox.width / 2;
    expect(Math.abs(cluster.x + cluster.width / 2 - barCenter)).toBeLessThan(3);
    expect(zoom.x).toBeLessThan(cluster.x);
    expect(volume.x).toBeGreaterThan(cluster.x + cluster.width);
    // Right-aligned against the bar's padding.
    expect(barBox.x + barBox.width - (volume.x + volume.width)).toBeLessThan(
      24,
    );
  });

  test("doesn't overflow a phone-width screen", async () => {
    await setViewport({ width: 375, height: 740 });
    const screen = await renderBar();

    await expect
      .element(screen.getByRole("slider", { name: "Preview volume" }))
      .toBeVisible();
    const bar = document.querySelector(".transport-bar") as HTMLElement;
    expect({
      bar: bar.scrollWidth - bar.clientWidth,
      page: document.documentElement.scrollWidth - window.innerWidth,
    }).toEqual({ bar: 0, page: 0 });
    const volume = query(".volume-control");
    expect(volume.x + volume.width).toBeLessThanOrEqual(375);
  });

  test("mute keeps the slider position and the volume survives a remount", async () => {
    const first = await renderBar();
    const slider = first.getByRole("slider", { name: "Preview volume" });
    await expect.element(slider).toHaveValue("1");

    await slider.fill("0.4");
    await expect.element(slider).toHaveAttribute("aria-valuetext", "40%");
    await first.getByRole("button", { name: "Mute preview" }).click();
    await expect.element(slider).toHaveValue("0.4");
    await expect
      .element(slider)
      .toHaveAttribute("aria-valuetext", "40%, muted");

    // A new session reads the volume back from storage, as after a reload.
    await first.unmount();
    const screen = await renderBar();
    const volumeSlider = screen.getByRole("slider", { name: "Preview volume" });
    await expect.element(volumeSlider).toHaveValue("0.4");
    await screen.getByRole("button", { name: "Unmute preview" }).click();
    await expect
      .element(screen.getByRole("button", { name: "Mute preview" }))
      .toBeVisible();

    // Dragging the slider above zero while muted unmutes.
    await screen.getByRole("button", { name: "Mute preview" }).click();
    await volumeSlider.fill("0.6");
    await expect
      .element(screen.getByRole("button", { name: "Mute preview" }))
      .toBeVisible();
  });
});

describe("TransportBar compact layout", () => {
  // The toolbar row under the top bar and the transport bar are compact
  // like the menu bar (#1222): each about 20%
  // shorter than before (73px), with controls about 20% smaller, all still
  // centered and comfortably clickable.

  beforeEach(async () => {
    await setViewport({ width: 1440, height: 900 });
  });

  function expectCenteredIn(
    bar: string,
    controls: NodeListOf<Element>,
    { buttons = true } = {},
  ) {
    const barBox = query(bar);
    const barCenter = barBox.y + barBox.height / 2;
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const { y, height } = box(control);
      expect(y).toBeGreaterThanOrEqual(barBox.y);
      expect(y + height).toBeLessThanOrEqual(barBox.y + barBox.height);
      expect(Math.abs(y + height / 2 - barCenter)).toBeLessThanOrEqual(1);
      expect(height).toBeLessThanOrEqual(36);
      // Smaller, but still an easy click.
      if (buttons) expect(height).toBeGreaterThanOrEqual(20);
    }
  }

  test("the toolbar row is compact and its controls fit it", async () => {
    const screen = await render(
      <TransportHarness playheadSignal={createPlayheadSignal()} />,
    );
    expect(query(".timeline-toolbar").height).toBeLessThanOrEqual(60);
    expectCenteredIn(
      ".timeline-toolbar",
      document.querySelectorAll(
        ".timeline-toolbar :is(.segmented-control, .tempo-pill, .signature-picker)",
      ),
    );
    for (const name of ["Sessions", "Tempo", "Snap On"]) {
      const button = screen.getByRole("button", { name, exact: true });
      expect(button.element().closest(".timeline-toolbar")).not.toBeNull();
      expect(box(button.element()).height).toBeGreaterThanOrEqual(24);
    }
  });

  test("the transport bar is compact and its controls fit it", async () => {
    const screen = await render(
      <TransportHarness playheadSignal={createPlayheadSignal()} />,
    );
    expect(query(".transport-bar").height).toBeLessThanOrEqual(60);
    expectCenteredIn(
      ".transport-bar",
      document.querySelectorAll(
        ".transport-bar :is(.transport-button, .zoom-control__button, .zoom-control__readout)",
      ),
    );
    expectCenteredIn(
      ".transport-bar",
      document.querySelectorAll(
        ".transport-bar :is(.zoom-control__slider, .vu-meter)",
      ),
      { buttons: false },
    );
    // The transport buttons stay the bar's largest controls.
    const play = box(
      screen.getByRole("button", { name: "Play timeline" }).element(),
    );
    expect(play.height).toBeGreaterThanOrEqual(32);
    expect(play.width).toBeGreaterThanOrEqual(play.height);
  });

  // A real mouse drag, through the browser's input pipeline.
  async function dragMouse(
    from: { x: number; y: number },
    to: { x: number; y: number },
    steps: number,
  ) {
    const send = (
      type: "mouseMoved" | "mousePressed" | "mouseReleased",
      x: number,
      y: number,
    ) =>
      cdp().send("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: "left",
        buttons: type === "mouseReleased" ? 0 : 1,
        clickCount: 1,
      });
    await send("mouseMoved", from.x, from.y);
    await send("mousePressed", from.x, from.y);
    for (let step = 1; step <= steps; step += 1) {
      await send(
        "mouseMoved",
        from.x + ((to.x - from.x) * step) / steps,
        from.y + ((to.y - from.y) * step) / steps,
      );
    }
    await send("mouseReleased", to.x, to.y);
  }

  test("the sliders still drag accurately", async () => {
    const screen = await render(
      <TransportHarness playheadSignal={createPlayheadSignal()} />,
    );
    const slider = screen.getByRole("slider", { name: "Preview volume" });
    const track = box(slider.element());
    const y = track.y + track.height / 2;
    await dragMouse(
      { x: track.x + 2, y },
      { x: track.x + track.width / 2, y },
      5,
    );
    const value = Number((slider.element() as HTMLInputElement).value);
    expect(value).toBeGreaterThan(0.4);
    expect(value).toBeLessThan(0.6);
  });

  // Sharp icons (#1224): the bars shrink by padding, never by scaling icons,
  // and everything lands on whole pixels, so nothing renders blurred.

  function rects(selector: string) {
    return [...document.querySelectorAll(selector)].map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      const control = element.closest("button, [aria-label]");
      return {
        name: control?.getAttribute("aria-label") ?? String(element.className),
        className: control?.className ?? "",
        x,
        y,
        width,
        height,
      };
    });
  }

  function expectWhole(
    rect: Record<string, string | number>,
    keys: string[] = ["x", "y", "width", "height"],
  ) {
    for (const key of keys) {
      const value = Number(rect[key]);
      expect(
        Math.abs(value - Math.round(value)),
        `${rect.name} ${key} = ${value}`,
      ).toBeLessThan(0.01);
    }
  }

  function defaultIconSize(className: string) {
    if (className.includes("transport-button--record")) return 18;
    if (className.includes("transport-button")) return 20;
    if (className.includes("zoom-control__button")) return 16;
    if (className.includes("select-trigger")) return 14;
    return undefined;
  }

  test("icons keep their default sizes on whole pixels", async () => {
    await render(<TransportHarness playheadSignal={createPlayheadSignal()} />);
    const icons = rects(".timeline-toolbar svg, .transport-bar svg");
    // Seven transport buttons, zoom − / +, mute and the time signature
    // chevron.
    expect(icons.length).toBeGreaterThanOrEqual(11);
    for (const icon of icons) {
      const size = defaultIconSize(String(icon.className));
      expect(size, `${icon.name} has a known default size`).toBeDefined();
      expect([icon.name, icon.width, icon.height]).toEqual([
        icon.name,
        size,
        size,
      ]);
      expectWhole(icon);
    }
  });

  test("the bars and their buttons sit on whole pixels", async () => {
    await render(<TransportHarness playheadSignal={createPlayheadSignal()} />);
    for (const bar of rects(".timeline-toolbar, .transport-bar")) {
      expectWhole(bar, ["y", "height"]);
    }
    // Text buttons are as wide as their labels; their heights and rows are
    // still whole.
    const buttons = rects(
      ".timeline-toolbar button, .transport-bar :is(.transport-button, .zoom-control__button, .zoom-control__readout)",
    );
    for (const button of buttons) expectWhole(button, ["y", "height"]);
    // Icon buttons are whole all round, so their icons center on whole
    // pixels.
    const iconButtons = rects(
      ".transport-bar :is(.transport-button, .zoom-control__button)",
    );
    for (const button of iconButtons) expectWhole(button);
  });
});
