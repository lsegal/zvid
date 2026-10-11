import { afterEach, describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { DEFAULT_PREVIEW_VOLUME } from "../../app/preview-volume.ts";
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
    expect(query(".vu-meter__readout").textContent).toMatch(/^\+\d+\.\d dB$/);
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
