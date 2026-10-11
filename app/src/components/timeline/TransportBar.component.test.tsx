import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { type RenderResult, render } from "vitest-browser-react";
import { DEFAULT_PREVIEW_VOLUME } from "../../app/preview-volume.ts";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
} from "../../component-test/editor.tsx";
import { center, click } from "../../component-test/input.ts";
import { setViewport } from "../../component-test/viewport.ts";
import {
  createMeterTap,
  type MasterMeterTap,
} from "../../fx-shaders/audio-bands.ts";
import { createPlayheadSignal } from "../../playhead-signal.ts";
import { TransportBar } from "./TransportBar";

// The transport bar's stereo VU meter, left of the preview volume. The
// meter's own levels are checked against a real mix in vu-meter.spec.ts
// and against test tones in vu-meter.component.test.tsx; these tests cover
// its layout and colors, fed by an oscillator where they need a level.
const SILENT = "-inf dB";
const noop = () => {};

function transportBar({
  isPlaying = false,
  getMeterTap = () => null,
}: {
  isPlaying?: boolean;
  getMeterTap?: () => MasterMeterTap | null;
} = {}) {
  return (
    <div className="app-shell">
      <TransportBar
        canRecord={false}
        flushZoomDraft={noop}
        getMeterTap={getMeterTap}
        isPlaying={isPlaying}
        isRecording={false}
        jumpHalfBar={noop}
        loopRegion={null}
        onRandomize={noop}
        onTransportToggle={noop}
        playbackEndQ={16}
        playFromLoopStart={noop}
        playheadSignal={createPlayheadSignal()}
        previewVolume={DEFAULT_PREVIEW_VOLUME}
        resolvedZoom={1}
        setPreviewVolume={noop}
        setZoomValue={noop}
        skipToEdge={noop}
        toggleRecording={noop}
        togglePreviewMute={noop}
        updateZoomDraft={noop}
      />
    </div>
  );
}

function renderTransportBar() {
  return render(transportBar());
}

function query<T extends Element = HTMLElement>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`${selector} is not rendered`);
  }
  return element;
}

function rect(selector: string) {
  return query(selector).getBoundingClientRect();
}

function muteButton() {
  const button = [...document.querySelectorAll("button")].find((element) =>
    /mute preview/i.test(element.getAttribute("aria-label") ?? ""),
  );
  if (!button) {
    throw new Error("The mute button is not rendered");
  }
  return button.getBoundingClientRect();
}

function channels() {
  return [...document.querySelectorAll<HTMLElement>('[role="meter"]')];
}

function readoutDb() {
  const text = query(".vu-meter__readout").textContent ?? "";
  return text === SILENT
    ? -Infinity
    : Number(text.replace(" dB", "").replace("−", "-"));
}

function isRed(color: string) {
  const [red, green, blue, alpha = 1] = (color.match(/[\d.]+/g) ?? []).map(
    Number,
  );
  return alpha > 0 && red > 2 * Math.max(green, blue, 20);
}

function zoneBackgrounds() {
  return [...document.querySelectorAll(".vu-meter__zone")].map(
    (zone) => getComputedStyle(zone).backgroundColor,
  );
}

// The bars → readout and readout → mute button gaps.
function readoutGaps() {
  const bars = rect(".vu-meter__bars");
  const text = rect(".vu-meter__readout");
  const mute = muteButton();
  return {
    before: text.x - (bars.x + bars.width),
    after: mute.x - (text.x + text.width),
  };
}

// A running audio graph playing a 440 Hz sine into a meter tap at `gain`.
// The click is the user activation Chromium wants before audio starts.
const contexts: AudioContext[] = [];
async function oscillatorTap(gain: number) {
  await userEvent.click(document.body);
  const context = new AudioContext();
  contexts.push(context);
  await context.resume();
  const { input, tap } = createMeterTap(context);
  const oscillator = context.createOscillator();
  const level = context.createGain();
  level.gain.value = gain;
  oscillator.connect(level).connect(input);
  oscillator.start();
  return { tap, level };
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

describe("the transport bar's VU meter", () => {
  test("sits left of the volume control and starts empty", async () => {
    await setViewport({ width: 1600, height: 900 });
    await renderTransportBar();
    const meter = rect(".vu-meter");
    const mute = muteButton();
    expect(meter.x + meter.width).toBeLessThanOrEqual(mute.x);
    expect(
      Math.abs(meter.y + meter.height / 2 - (mute.y + mute.height / 2)),
    ).toBeLessThan(2);

    expect(channels().map((channel) => channel.ariaLabel)).toEqual([
      "Left level",
      "Right level",
    ]);
    for (const channel of channels()) {
      expect(channel.getAttribute("aria-valuemin")).toBe("-60");
      expect(channel.getAttribute("aria-valuemax")).toBe("6");
      expect(channel.getAttribute("aria-valuenow")).toBe("-60");
    }
    expect(query(".vu-meter__readout").textContent).toBe(SILENT);
    expect(query(".vu-meter__readout").getAttribute("aria-live")).toBe("off");
  });

  test("hides before the volume slider in a narrow bar", async () => {
    await setViewport({ width: 1440, height: 900 });
    await renderTransportBar();
    // Wherever the meter shows, it never pushes into the transport buttons.
    for (const width of [1440, 1280, 1180, 1100, 1024, 960, 901]) {
      await setViewport({ width, height: 900 });
      const cluster = rect(".transport-cluster");
      const volume = rect(".volume-control");
      expect(volume.x, `at ${width}px`).toBeGreaterThanOrEqual(
        cluster.x + cluster.width,
      );
    }

    await setViewport({ width: 375, height: 740 });
    expect(getComputedStyle(query(".vu-meter")).display).toBe("none");
    const slider = query('[aria-label="Preview volume"]');
    expect(slider.getBoundingClientRect().width).toBeGreaterThan(0);
  });

  test("is red only while a channel clips", async () => {
    await setViewport({ width: 1600, height: 900 });
    const quiet = await oscillatorTap(0.5);
    const screen = await renderTransportBar();
    for (const channel of channels()) {
      expect(channel.getBoundingClientRect().height).toBe(5);
    }
    for (const color of zoneBackgrounds()) {
      expect(isRed(color), color).toBe(false);
    }

    // A loud mix short of clipping leaves the above-0 zone alone.
    const getMeterTap = () => quiet.tap;
    await screen.rerender(transportBar({ isPlaying: true, getMeterTap }));
    await expect.poll(readoutDb).toBeGreaterThan(-30);
    for (const color of zoneBackgrounds()) {
      expect(isRed(color), color).toBe(false);
    }

    // Above full scale, both channels latch the clip zone red.
    quiet.level.gain.value = 2;
    await expect
      .poll(() => document.querySelectorAll(".vu-meter__channel.is-clipped"))
      .toHaveLength(2);
    for (const color of zoneBackgrounds()) {
      expect(isRed(color), color).toBe(true);
    }
    // The readout's average rises after the clip zone latches.
    await expect
      .poll(() => query(".vu-meter__readout").textContent)
      .toMatch(/^\+\d+\.\d dB$/);
  });

  test("spaces the readout evenly between the bars and the mute button", async () => {
    await setViewport({ width: 1600, height: 900 });
    await renderTransportBar();
    expect(query(".vu-meter__readout").textContent).toBe(SILENT);
    const silent = readoutGaps();
    expect(Math.abs(silent.before - silent.after)).toBeLessThanOrEqual(1);

    query(".vu-meter__readout").textContent = "−6.0 dB";
    const loud = readoutGaps();
    expect(Math.abs(loud.before - loud.after)).toBeLessThanOrEqual(1);
    expect(Math.abs(loud.before - silent.before)).toBeLessThanOrEqual(1);
  });
});

// The transport bar's zoom control: the -/+ buttons step along a ladder from
// 25% to 300%, and the ruler thins its labels when zoomed far out.

let screen: RenderResult;

function readout() {
  return screen.container.querySelector(".zoom-control__readout")?.textContent;
}

async function stepUntilDisabled(name: "Zoom in" | "Zoom out") {
  const button = screen.getByRole("button", { name, exact: true });
  const seen: string[] = [];
  while (!(button.element() as HTMLButtonElement).disabled) {
    const before = readout();
    const { x, y } = center(button.element());
    await click(x, y);
    await expect.poll(readout).not.toBe(before);
    seen.push(readout() ?? "");
  }
  return seen;
}

describe(TransportBar, { timeout: EDITOR_TEST_TIMEOUT }, () => {
  beforeEach(async () => {
    screen = await renderEditor();
    await expect.poll(readout).toBe("100%");
  });

  test("the zoom buttons step along the ladder to 25% and 300%", async () => {
    expect(await stepUntilDisabled("Zoom out")).toEqual([
      "80%",
      "67%",
      "50%",
      "33%",
      "25%",
    ]);
    expect(await stepUntilDisabled("Zoom in")).toEqual([
      "33%",
      "50%",
      "67%",
      "80%",
      "100%",
      "125%",
      "150%",
      "200%",
      "250%",
      "300%",
    ]);
  });

  test("the slider reaches both ends of the range", async () => {
    const slider = screen.getByRole("slider", { name: "Timeline zoom" });
    (slider.element() as HTMLElement).focus();
    await userEvent.keyboard("{Home}");
    await expect.poll(readout).toBe("25%");
    await userEvent.keyboard("{End}");
    await expect.poll(readout).toBe("300%");
  });

  test("the ruler labels fewer bars at 25%", async () => {
    const labeled = () =>
      [...screen.container.querySelectorAll(".ruler-marker span")]
        .slice(0, 4)
        .map((label) => Number(label.textContent));
    expect(labeled()).toEqual([1, 2, 3, 4]);

    await stepUntilDisabled("Zoom out");
    // A 4/4 bar is 28px at 25%, so every 2nd bar keeps its number.
    await expect.poll(labeled).toEqual([1, 3, 5, 7]);
  });
});
