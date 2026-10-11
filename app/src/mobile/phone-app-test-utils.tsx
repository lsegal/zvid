// Helpers for component tests that drive the whole editor on a touch screen:
// they mount App with a fresh session and send real touches through CDP, so
// swipes scroll natively as on a phone. Only the *.component.test.tsx files
// import this module.
import { StrictMode } from "react";
import { expect } from "vitest";
import { cdp, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import videoUrl from "../../e2e/fixtures/test-pattern.mp4?url";
import audioVideoUrl from "../../e2e/fixtures/test-pattern-audio.webm?url";
import App from "../App.tsx";
import type { WorkspaceBoot } from "../app/workspace-types.ts";
import { installHarness } from "../harness";

export type Point = { x: number; y: number };

type TouchType = "touchStart" | "touchMove" | "touchEnd";

// A four-second test pattern at 120 BPM spans eight quarters; the other one
// has an audio track.
export const VIDEO = videoUrl;
export const AUDIO_VIDEO = audioVideoUrl;

export function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The e2e specs these tests replace gave each test Playwright's 180 s;
// a whole editor on a busy machine needs more than Vitest's 15 s.
export const PLAYWRIGHT_TEST_TIMEOUT = 180_000;

let harnessReady: Promise<unknown> | null = null;

// Owns the session without a Web Lock, so every mount starts empty and no
// mount waits on the one before it.
function freshBoot(): WorkspaceBoot {
  return {
    session: null,
    corruptKey: null,
    access: "owner",
    lock: {
      acquire: async () => true,
      takeOver: async () => {},
      isOwner: () => true,
      dispose: () => {},
    },
  };
}

// Mounts the editor as main.tsx does, with nothing restored: saved label
// widths and row heights from an earlier test are cleared first.
export async function renderApp() {
  localStorage.clear();
  sessionStorage.clear();
  harnessReady ??= installHarness();
  await harnessReady;
  const screen = await render(
    <StrictMode>
      <App boot={freshBoot()} />
    </StrictMode>,
  );
  await expect.poll(() => document.querySelector(".app-shell")).not.toBeNull();
  await expect
    .poll(() => document.querySelector('[data-timeline-lane-id="1"]'))
    .not.toBeNull();
  return screen;
}

// The test page runs in an iframe; CDP touches land in the top page's
// coordinates.
function frameOffset() {
  const frame = window.frameElement;
  if (!frame) {
    return { x: 0, y: 0, scale: 1 };
  }
  const box = frame.getBoundingClientRect();
  const scale = box.width / window.innerWidth || 1;
  return { x: box.left, y: box.top, scale };
}

export function touch(type: TouchType, points: Point[]) {
  const offset = frameOffset();
  return cdp().send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((point, id) => ({
      x: offset.x + point.x * offset.scale,
      y: offset.y + point.y * offset.scale,
      id,
    })),
  });
}

// Sends `steps` in order, `gapMs` apart. Short gaps don't wait for each
// touch to land: a CDP round trip from the test page is slow enough to turn
// a swipe into a hold. A longer gap is a hold, timed from when the touch
// before it landed, so a slow round trip can't shorten it.
async function gesture(steps: Array<[TouchType, Point[]]>, gapMs: number[]) {
  const sent: Promise<unknown>[] = [];
  for (const [index, [type, points]] of steps.entries()) {
    sent.push(touch(type, points));
    const gap = gapMs[index] ?? 0;
    if (gap >= 100) {
      await Promise.all(sent);
    }
    if (gap) {
      await wait(gap);
    }
  }
  await Promise.all(sent);
}

// A finger from `from` to `to` in steps, after holding still for `holdMs`.
export async function drag(from: Point, to: Point, holdMs = 0) {
  const steps: Array<[TouchType, Point[]]> = [["touchStart", [from]]];
  const gaps = [holdMs];
  const count = 12;
  for (let step = 1; step <= count; step += 1) {
    steps.push([
      "touchMove",
      [
        {
          x: from.x + ((to.x - from.x) * step) / count,
          y: from.y + ((to.y - from.y) * step) / count,
        },
      ],
    ]);
    gaps.push(16);
  }
  steps.push(["touchEnd", []]);
  await gesture(steps, gaps);
}

// A finger down at `at` for `ms`, then up.
export async function hold(at: Point, ms = 700) {
  await gesture(
    [
      ["touchStart", [at]],
      ["touchEnd", []],
    ],
    [ms],
  );
}

// Moves one finger from `from` to `to` in `count` steps `gapMs` apart,
// without lifting it.
export async function moveFinger(
  from: Point,
  to: Point,
  count: number,
  gapMs = 16,
) {
  const steps: Array<[TouchType, Point[]]> = [];
  for (let step = 1; step <= count; step += 1) {
    steps.push([
      "touchMove",
      [
        {
          x: from.x + ((to.x - from.x) * step) / count,
          y: from.y + ((to.y - from.y) * step) / count,
        },
      ],
    ]);
  }
  await gesture(
    steps,
    steps.map(() => gapMs),
  );
}

// A quick touch, as Playwright's tap sends it.
export async function tap(element: Element) {
  await hold(centerOf(element), 0);
}

export function query(selector: string) {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`${selector} is not in the document`);
  }
  return element as HTMLElement;
}

export function boxOf(selector: string) {
  return query(selector).getBoundingClientRect();
}

export function centerOf(target: string | Element) {
  const box =
    typeof target === "string" ? boxOf(target) : target.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) {
    throw new Error(`${String(target)} is not visible`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function isVisible(element: Element | null) {
  if (!element) {
    return false;
  }
  const box = element.getBoundingClientRect();
  return (
    box.width > 0 &&
    box.height > 0 &&
    getComputedStyle(element).visibility !== "hidden"
  );
}

function accessibleName(element: Element) {
  const label = element.getAttribute("aria-label");
  if (label !== null) {
    return label.trim();
  }
  const labelledBy = element.getAttribute("aria-labelledby");
  const labelElement = labelledBy && document.getElementById(labelledBy);
  return ((labelElement || element).textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function nameMatches(element: Element, name: string | RegExp, exact: boolean) {
  const actual = accessibleName(element);
  if (typeof name !== "string") {
    return name.test(actual);
  }
  return exact
    ? actual === name
    : actual.toLowerCase().includes(name.toLowerCase());
}

const IMPLICIT_ROLES: Record<string, string> = {
  button: "button",
  navigation: "nav",
  heading: "h1, h2, h3, h4, h5, h6",
  separator: "hr",
};

// The visible elements with `role` whose accessible name (an aria-label or
// their text) matches `name` as Playwright's getByRole does: a string
// matches a case-insensitive substring unless `exact`.
export function visibleByRole(
  role: string,
  name: string | RegExp,
  { exact = false, root = document as ParentNode } = {},
) {
  const selector = [`[role="${role}"]`, IMPLICIT_ROLES[role]]
    .filter(Boolean)
    .join(", ");
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (element) => isVisible(element) && nameMatches(element, name, exact),
  );
}

// Waits for the one visible element with `role` and `name`, and returns it.
export async function findByRole(
  role: string,
  name: string | RegExp,
  options: { exact?: boolean; root?: ParentNode } = {},
) {
  await expect
    .poll(() => visibleByRole(role, name, options).length, {
      message: `one visible ${role} named "${String(name)}"`,
    })
    .toBe(1);
  return visibleByRole(role, name, options)[0];
}

// A mouse click, as Playwright's click sends one.
export async function click(
  role: string,
  name: string | RegExp,
  options: { exact?: boolean; root?: ParentNode } = {},
) {
  await userEvent.click(await findByRole(role, name, options));
}

// Sheets slide in and out (#1211); a drag measured mid-slide starts in the
// wrong place, so wait for the sheet to come to rest first.
export async function settled(selector: string) {
  await expect
    .poll(() => document.querySelector(selector)?.getAnimations().length)
    .toBe(0);
}

export function playheadQ() {
  const text = query(".mobile-transport__position").innerText;
  const [bar, beat, sixteenth] = text.split(".").map(Number);
  return (bar - 1) * 4 + (beat - 1) + (sixteenth - 1) / 4;
}

// Waits out a swipe's fling: touches during one can't stop the scroll.
export async function settledPlayheadQ() {
  let last = Number.NaN;
  await expect
    .poll(async () => {
      const previous = last;
      await wait(100);
      last = playheadQ();
      return last === previous;
    })
    .toBe(true);
  return last;
}

export async function chooseFromMore(item: string) {
  await click("button", "More", { exact: true });
  await click("menuitem", item);
}

// Puts the test pattern on Layer 1 through the phone's own menus: show the
// source tracks, drop the file, then Copy to layer from the clip's menu
// sheet.
export async function addClip(url = VIDEO) {
  await chooseFromMore("Show Source Tracks");
  const bytes = await (await fetch(url)).arrayBuffer();
  const name = url.split("?")[0].split("/").pop() ?? "";
  const type = name.endsWith(".webm") ? "video/webm" : "video/mp4";
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], name, { type }));
  await expect
    .poll(() =>
      document.querySelector('[data-source-track-drop-target="new-track"]'),
    )
    .not.toBeNull();
  const target = query('[data-source-track-drop-target="new-track"]');
  for (const eventType of ["dragenter", "dragover", "drop"]) {
    target.dispatchEvent(
      new DragEvent(eventType, {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  }
  await expect
    .poll(() => document.querySelectorAll(".source-span").length, {
      timeout: 30_000,
    })
    .toBe(1);
  query(".source-span").dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
  );
  await click("menuitem", "Copy to layer");
  await click("menuitem", /Layer 1/);
  await expect
    .poll(() => document.querySelectorAll(".clip-card").length)
    .toBe(1);
  await chooseFromMore("Hide Source Tracks");
  await expect
    .poll(() => isVisible(document.querySelector(".source-span")))
    .toBe(false);
}

// A new session starts with one layer, Layer 1 ("1"); this inserts `count`
// more below it from the last header's menu, as e2e/layers.ts does.
export async function addLayers(count: number) {
  for (let index = 1; index <= count; index += 1) {
    const headers = document.querySelectorAll("[data-layer-header-id]");
    const last = headers[headers.length - 1];
    last.scrollIntoView({ block: "nearest" });
    last.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        ...centerOf(last),
      }),
    );
    const menu = await findByRole("menu", "Layer header actions");
    await click("menuitem", "Insert layer below", { exact: true, root: menu });
    await expect
      .poll(() => document.querySelectorAll("[data-layer-header-id]").length)
      .toBe(index + 1);
  }
}

// Where the playhead line, the labels' right edge, the view's center and
// time 0 (Layer 1's lane) sit, and how far the timeline has scrolled.
export function timelineEdges() {
  const left = (selector: string) =>
    document.querySelector(selector)?.getBoundingClientRect().left ?? 0;
  const label = document
    .querySelector('[data-layer-header-id="1"]')
    ?.getBoundingClientRect();
  const scroll = query(".timeline-scroll");
  const view = scroll.getBoundingClientRect();
  return {
    line: left(".timeline-playhead"),
    labels: label ? label.right : 0,
    center: view.left + view.width / 2,
    lane: left('[data-timeline-lane-id="1"]'),
    scrollLeft: scroll.scrollLeft,
  };
}
