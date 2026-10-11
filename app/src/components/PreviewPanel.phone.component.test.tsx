/// <reference types="@vitest/browser-playwright" />
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  PHONE_LANDSCAPE_VIEWPORT,
  usePhone,
} from "../component-test/viewport.ts";
import { createMeterTap, type MasterMeterTap } from "../fx-shaders/audio-bands";
import { PhoneEditor } from "./mobile/phone-editor.fixture.tsx";
import { PreviewPanel } from "./PreviewPanel";

// The phone shell's preview header, Scopes and Audio panes, transport VU
// meter and status toast (#1177): the desktop pieces the phone layout used
// to hide outright. The e2e specs' small phone.
const SMALL_PHONE = { width: 375, height: 667 } as const;

type Box = { top: number; bottom: number; left: number; right: number };

function boxes<Key extends string>(selectors: Record<Key, string>) {
  const result = {} as Record<Key, Box | null>;
  for (const [key, selector] of Object.entries(selectors) as [Key, string][]) {
    const rect = document.querySelector(selector)?.getBoundingClientRect();
    result[key] = rect
      ? {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
        }
      : null;
  }
  return result;
}

function overlaps(a: Box | null, b: Box | null) {
  return Boolean(
    a &&
      b &&
      a.left < b.right &&
      b.left < a.right &&
      a.top < b.bottom &&
      b.top < a.bottom,
  );
}

function heightOf(box: Box | null) {
  return (box?.bottom ?? 0) - (box?.top ?? 0);
}

function pageScrolls() {
  return (
    document.documentElement.scrollHeight > window.innerHeight ||
    document.documentElement.scrollWidth > window.innerWidth
  );
}

const header = () =>
  document.querySelector(".preview-panel__header") as HTMLElement;
const region = (name: string) => page.getByRole("region", { name });
// The header's buttons: the tab bar has an Audio button too.
const scopesButton = () => page.getByRole("button", { name: "Scopes" });
const audioButton = () => page.getByTitle(/the audio meter and spectrogram$/);
// The transport's meter: the Audio pane has one too.
const transportLevel = () =>
  document.querySelector(
    '.mobile-transport [role="meter"][aria-label="Left level"]',
  ) as HTMLElement;

async function togglePanes() {
  await scopesButton().click();
  await audioButton().click();
}

async function openPanes() {
  await togglePanes();
  await expect.element(region("Scopes")).toBeVisible();
  await expect.element(region("Audio analysis")).toBeVisible();
}

// A finger dragged straight down by `dy` (up when negative), through CDP so
// the page would scroll or refresh if the splitter let it.
async function touchDrag(from: { x: number; y: number }, dy: number) {
  const point = (y: number) => [{ x: from.x, y, id: 0 }];
  await cdp().send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: point(from.y),
  });
  const steps = 10;
  for (let step = 1; step <= steps; step += 1) {
    await cdp().send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(from.y + (dy * step) / steps),
    });
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  await cdp().send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

async function tap(x: number, y: number) {
  await cdp().send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 0 }],
  });
  await cdp().send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

// A 440 Hz tone at about -13 dBFS RMS through a meter tap, as the preview's
// program mix feeds the transport's meter while it plays.
let audio: AudioContext | null = null;
async function toneTap(): Promise<MasterMeterTap> {
  audio = new AudioContext();
  await audio.resume();
  const { input, tap } = createMeterTap(audio);
  const tone = audio.createOscillator();
  tone.frequency.value = 440;
  const level = audio.createGain();
  level.gain.value = 10_000 / 32_768;
  tone.connect(level).connect(input);
  tone.start();
  return tap;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  await audio?.close();
  audio = null;
  localStorage.clear();
});

describe(PreviewPanel.name, () => {
  test("Scopes and Audio open under the preview with no page scroll", async () => {
    await usePhone(SMALL_PHONE);
    await render(<PhoneEditor preview />);
    await expect.element(header()).toBeVisible();
    await openPanes();

    expect(pageScrolls()).toBe(false);
    const layout = boxes({
      header: ".preview-panel__header",
      monitor: ".preview-monitor",
      scopes: ".scopes-pane",
      audio: ".audio-analysis",
      transport: ".mobile-transport",
      timeline: ".timeline-panel",
      tabs: ".mobile-tab-bar",
    });
    // Header, monitor, then the panes side by side, all above the transport.
    expect(layout.header?.bottom).toBeLessThanOrEqual(layout.monitor?.top ?? 0);
    expect(layout.monitor?.bottom).toBeLessThanOrEqual(layout.scopes?.top ?? 0);
    expect(layout.scopes?.top).toBe(layout.audio?.top);
    expect(overlaps(layout.scopes, layout.audio)).toBe(false);
    for (const pane of [layout.scopes, layout.audio]) {
      expect(pane?.bottom).toBeLessThanOrEqual(layout.transport?.top ?? 0);
      expect(pane?.right).toBeLessThanOrEqual(SMALL_PHONE.width);
    }
    expect(layout.transport?.bottom).toBeLessThanOrEqual(
      layout.timeline?.top ?? 0,
    );
    // The timeline keeps room to work in.
    expect(heightOf(layout.timeline)).toBeGreaterThan(100);
    expect(layout.timeline?.bottom).toBeLessThanOrEqual(layout.tabs?.top ?? 0);

    await togglePanes();
    await expect.element(region("Scopes")).not.toBeInTheDocument();
    await expect.element(region("Audio analysis")).not.toBeInTheDocument();
  });

  test("the transport's VU meter moves with playback", async () => {
    await usePhone(SMALL_PHONE);
    const tap = await toneTap();
    await render(<PhoneEditor getMeterTap={() => tap} isPlaying preview />);
    const level = transportLevel();
    await expect.element(level).toBeVisible();
    await expect
      .poll(() => Number(level.getAttribute("aria-valuenow")), {
        timeout: 15_000,
      })
      .toBeGreaterThan(-40);
    const layout = boxes({
      meter: ".mobile-transport .vu-meter",
      transport: ".mobile-transport",
    });
    expect(layout.meter?.bottom).toBeLessThanOrEqual(
      layout.transport?.bottom ?? 0,
    );
    expect(layout.meter?.right).toBeLessThanOrEqual(SMALL_PHONE.width);
    expect(pageScrolls()).toBe(false);
  });

  // Record's hint with no armed track (usePhoneShell) stays an e2e check.
  test("a status message shows as a toast clear of the transport and tabs", async () => {
    await usePhone(SMALL_PHONE);
    await render(
      <PhoneEditor
        preview
        status={{ text: "Arm a source track to record a take.", tone: "info" }}
      />,
    );
    await expect
      .element(
        page
          .getByRole("status")
          .filter({ hasText: "Arm a source track to record a take." }),
      )
      .toBeVisible();
    const layout = boxes({
      toast: ".status-bar__message",
      transport: ".mobile-transport",
      tabs: ".mobile-tab-bar",
    });
    expect(overlaps(layout.toast, layout.transport)).toBe(false);
    expect(overlaps(layout.toast, layout.tabs)).toBe(false);
    expect(layout.toast?.left).toBeGreaterThanOrEqual(0);
    expect(layout.toast?.right).toBeLessThanOrEqual(SMALL_PHONE.width);
    expect(pageScrolls()).toBe(false);
  });

  // #1202: a readable plot, compact kind buttons with finger-sized taps,
  // and a splitter on the pane's foot that trades height with the timeline.
  test("the Scopes pane is readable, compact and resizable by touch", async () => {
    await usePhone(SMALL_PHONE);
    await render(<PhoneEditor preview />);
    await scopesButton().click();
    const pane = region("Scopes");
    await expect.element(pane).toBeVisible();
    const selectors = {
      monitor: ".preview-monitor",
      pane: ".scopes-pane",
      plot: ".scopes-pane__body",
      timeline: ".timeline-panel",
    };
    const start = boxes(selectors);
    expect(heightOf(start.plot)).toBeGreaterThan(110);

    // The kind buttons stay small, yet a tap well above or below one still
    // lands on it, and tapping each picks its scope.
    const kinds = pane.getByRole("toolbar", { name: "Scope" });
    for (const name of ["Waveform", "Parade", "Vectorscope", "Histogram"]) {
      const button = kinds.getByRole("button", { name, exact: true });
      const box = button.element().getBoundingClientRect();
      expect(box.height).toBeLessThan(24);
      const x = box.x + box.width / 2;
      for (const y of [box.y - 10, box.y + box.height + 10]) {
        expect(document.elementFromPoint(x, y)?.textContent).toBe(name);
      }
      await tap(x, box.y + box.height + 10);
      await expect.element(button).toHaveAttribute("aria-pressed", "true");
    }

    // Dragging the splitter up shrinks the pane, giving the timeline the
    // room, without scrolling the page or moving the monitor.
    const splitter = pane.getByRole("separator", { name: "Resize scopes" });
    expect(getComputedStyle(splitter.element()).touchAction).toBe("none");
    const grip = () => {
      const box = splitter.element().getBoundingClientRect();
      expect(box.height).toBeGreaterThanOrEqual(44);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    await touchDrag(grip(), -40);
    const shrunk = boxes(selectors);
    expect(
      Math.abs(heightOf(start.pane) - heightOf(shrunk.pane) - 40),
    ).toBeLessThan(3);
    expect(
      Math.abs(heightOf(shrunk.timeline) - heightOf(start.timeline) - 40),
    ).toBeLessThan(3);
    expect(shrunk.monitor).toEqual(start.monitor);
    expect(window.scrollY).toBe(0);
    expect(pageScrolls()).toBe(false);

    // Far down, the pane grows until the timeline is at its least height;
    // far up, the pane keeps its own.
    await touchDrag(grip(), 400);
    const tallest = boxes(selectors);
    expect(Math.abs(heightOf(tallest.timeline) - 100)).toBeLessThan(3);
    expect(pageScrolls()).toBe(false);
    await touchDrag(grip(), -400);
    expect(heightOf(boxes(selectors).pane)).toBeCloseTo(96, 0);

    // The height holds across the preview's tabs, as on desktop.
    await touchDrag(grip(), 60);
    const resized = heightOf(boxes(selectors).pane);
    const tabs = page.getByRole("tablist", { name: "Preview" });
    await tabs.getByRole("tab", { name: "Media" }).click();
    await tabs.getByRole("tab", { name: "Timeline" }).click();
    expect(heightOf(boxes(selectors).pane)).toBeCloseTo(resized, 0);
  });

  test("a landscape phone keeps the panes and VU meter beside the timeline", async () => {
    await usePhone(PHONE_LANDSCAPE_VIEWPORT);
    await render(<PhoneEditor preview />);
    expect(document.querySelector(".app-shell")?.classList).toContain(
      "app-shell--phone-landscape",
    );
    await openPanes();
    await expect.element(transportLevel()).toBeVisible();
    expect(pageScrolls()).toBe(false);
    const layout = boxes({
      monitor: ".preview-monitor",
      scopes: ".scopes-pane",
      audio: ".audio-analysis",
      transport: ".mobile-transport",
      timeline: ".timeline-panel",
    });
    expect(heightOf(layout.monitor)).toBeGreaterThan(60);
    for (const pane of [layout.monitor, layout.scopes, layout.audio]) {
      expect(pane?.bottom).toBeLessThanOrEqual(layout.transport?.top ?? 0);
      expect(pane?.right).toBeLessThanOrEqual(layout.timeline?.left ?? 0);
    }
  });
});
