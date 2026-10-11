import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import App from "../../../App.tsx";
import {
  bootWorkspace,
  readSavedWorkspaceSession,
} from "../../../app/workspace-boot.ts";
import {
  dropFiles,
  expectCount,
  fileTransfer,
  fixtureFile,
  mouse,
  query,
  queryAll,
  renderApp,
} from "../../../component-test/app.tsx";
import { installHarness } from "../../../harness";
import { getCachedMediaBlob } from "../../../media-cache.ts";

// Selecting a source clip shows its Start, Length and Offset in the FX panel.
// A four-second test pattern at 120 BPM spans eight quarters, so two dropped
// together sit back to back at 0–8 and 8–16.

// Ctrl on Linux and Windows, Cmd on macOS, as Playwright's ControlOrMeta.
const MOD = /mac/i.test(navigator.platform) ? "Meta" : "Control";

async function pressMod(key: string, { shift = false } = {}) {
  const down = shift ? `{${MOD}>}{Shift>}` : `{${MOD}>}`;
  const up = shift ? `{/Shift}{/${MOD}}` : `{/${MOD}}`;
  await userEvent.keyboard(`${down}${key}${up}`);
}

async function dropVideos(count: number) {
  const files = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      fixtureFile("test-pattern.mp4", `test-pattern-${index}.mp4`),
    ),
  );
  await dropFiles(
    query('[aria-label="Source track drop area"]'),
    fileTransfer(files),
  );
}

// Reloads the editor without clearing storage: flushes the autosave as
// pagehide does, unmounts, and boots again from the saved session and
// preferences. AppRoot caches its boot for the page's lifetime, so this
// reads the saved session again itself, as a fresh page's boot would,
// keeping the tab's workspace lock.
async function reload(screen: { unmount(): void }) {
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
  screen.unmount();
  const { lock } = await bootWorkspace();
  const owner = await lock.acquire();
  const { session, corruptKey } = await readSavedWorkspaceSession();
  await installHarness();
  const next = await render(
    <App
      boot={{ session, corruptKey, access: owner ? "owner" : "blocked", lock }}
    />,
  );
  await expect
    .poll(() => document.querySelector("[data-timeline-lane-id]"), {
      timeout: 30_000,
    })
    .toBeTruthy();
  return next;
}

function box(element: Element | null | undefined) {
  if (!element) {
    throw new Error("element is not visible");
  }
  const bounds = element.getBoundingClientRect();
  return {
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
  };
}

const spans = () => queryAll(".source-span");

// Where each span sits in its track, in quarters.
function layout(quarterPx: number) {
  return spans().map((element) => {
    const style = element.style;
    const startQ = Number.parseFloat(style.left) / quarterPx;
    const endQ = startQ + Number.parseFloat(style.width) / quarterPx;
    return [Math.round(startQ * 100) / 100, Math.round(endQ * 100) / 100];
  });
}

function properties() {
  const element = document.querySelector(".source-clip-properties");
  return element ? page.elementLocator(element) : null;
}

// The field named `name` in the Clip widget, or null while it isn't shown.
function field(name: string) {
  return (
    properties()?.getByRole("spinbutton", { name, exact: false }).query() ??
    null
  );
}

function fieldLocator(name: string) {
  const scope = properties();
  if (!scope) throw new Error("missing .source-clip-properties");
  return scope.getByRole("spinbutton", { name, exact: false });
}

async function expectField(name: string, attribute: string, value: string) {
  await expect
    .poll(() => field(name)?.getAttribute(attribute) ?? null, {
      timeout: 5_000,
    })
    .toBe(value);
}

// Drags a field's up/down handle by `deltaY` pixels; up increases.
async function dragField(name: string, deltaY: number) {
  const handle = field(name)?.querySelector(".time-value__handle");
  const bounds = box(handle);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await mouse.move(x, y);
  await mouse.down();
  await mouse.move(x, y + deltaY, 12);
  await mouse.up();
}

async function typeField(name: string, text: string) {
  await fieldLocator(name).getByRole("button").click();
  const input = fieldLocator(name).getByRole("textbox");
  await input.fill(text);
  await userEvent.keyboard("{Enter}");
}

// Text as Playwright's toHaveText compares it, whitespace normalized.
function text(selector: string) {
  return (query(selector).textContent ?? "").replace(/\s+/g, " ").trim();
}

const title = ".fx-panel__toggle";

test("source clip properties edit Start, Length and Offset, with undo", async () => {
  await renderApp();
  await dropVideos(2);
  await expectCount(".source-span", 2);
  const quarterPx = box(spans()[0]).width / 8;
  await expect
    .poll(() => layout(quarterPx))
    .toEqual([
      [0, 8],
      [8, 16],
    ]);

  // Selecting a source clip shows its properties in the current format,
  // ahead of its effects.
  await userEvent.click(spans()[0]);
  await expect.poll(() => text(title)).toMatch(/^Clip .+ Effects (.+)$/);
  await expect.element(query(".source-clip-properties")).toBeVisible();
  await expectField("Start", "aria-valuetext", "1.1.1");
  await expectField("Length", "aria-valuetext", "2.0.0");
  await expectField("Offset", "aria-valuetext", "0.0.0");

  // Switching the timeline to timecode shows the same values as timecode.
  await page.getByRole("button", { name: "Time", exact: true }).click();
  await expectField("Start", "aria-valuetext", "00:00:00");
  await expectField("Length", "aria-valuetext", "00:04:00");
  await page.getByRole("button", { name: "Tempo", exact: true }).click();
  await expectField("Length", "aria-valuetext", "2.0.0");

  // Typing a Start onto the next clip trims that clip like a drag would.
  await typeField("Start", "2.1.1");
  await expect
    .poll(() => layout(quarterPx))
    .toEqual([
      [4, 12],
      [12, 16],
    ]);
  await expectField("Start", "aria-valuenow", "4");

  // One undo reverts the one edit, and the field follows.
  await pressMod("z");
  await expect
    .poll(() => layout(quarterPx))
    .toEqual([
      [0, 8],
      [8, 16],
    ]);
  await expectField("Start", "aria-valuenow", "0");

  // Length shrinks by dragging down.
  await dragField("Length", 40);
  await expectField("Length", "aria-valuenow", "5.5");
  await expect
    .poll(() => layout(quarterPx))
    .toEqual([
      [0, 5.5],
      [8, 16],
    ]);
  // The whole drag is one undo step.
  await pressMod("z");
  await expectField("Length", "aria-valuenow", "8");
  await pressMod("z", { shift: true });
  await expectField("Length", "aria-valuenow", "5.5");

  // Length runs on past the media's end, which loops it, and trims the next
  // clip like a drag would.
  await typeField("Length", "3.0.0");
  await expectField("Length", "aria-valuenow", "12");
  await expect
    .poll(() => layout(quarterPx))
    .toEqual([
      [0, 12],
      [12, 16],
    ]);
  await pressMod("z");
  await expectField("Length", "aria-valuenow", "5.5");

  // Offset stops at the media's end going up, and at 0 going down.
  await dragField("Offset", -200);
  await expectField("Offset", "aria-valuenow", "8");
  await dragField("Offset", 400);
  await expectField("Offset", "aria-valuenow", "0");
  // Offset never moves the clip.
  expect(layout(quarterPx)).toEqual([
    [0, 5.5],
    [8, 16],
  ]);

  // Selecting a layer brings back its effects.
  await userEvent.click(
    query('[data-layer-header-id="1"] .track-label__select'),
  );
  await expect.poll(() => text(title)).toBe("Layer 1 Effects");
  await expectCount(".source-clip-properties", 0);
}, 120_000);

// The Clip widget's title row matches an FX device's: same height, a 1px
// divider, and the name inset from the rounded border like the fields.
test("the Clip widget title row matches an FX device title row", async () => {
  await renderApp();
  await dropVideos(1);
  await expectCount(".source-span", 1);
  await userEvent.click(spans()[0]);

  const clipTitleSelector =
    ".source-clip-properties__device .fx-device-panel__title";
  await expect
    .poll(() => document.querySelector(clipTitleSelector))
    .toBeTruthy();
  await expect.element(query(clipTitleSelector)).toBeVisible();
  const device = query(".source-clip-properties__device");
  const clipTitle = query(clipTitleSelector);
  const clipHeight = box(clipTitle).height;
  const nameInset =
    box(clipTitle.querySelector(".fx-device-panel__name")).x - box(device).x;
  expect(nameInset).toBeGreaterThanOrEqual(12);
  const style = getComputedStyle(clipTitle);
  expect([style.borderBottomWidth, style.borderBottomStyle]).toEqual([
    "1px",
    "solid",
  ]);

  await userEvent.click(
    query('[data-layer-header-id="1"] .track-label__select'),
  );
  const layoutTitle = () =>
    document.querySelector(
      'section[aria-label="Layout"] .fx-device-panel__title',
    );
  await expect.poll(layoutTitle).toBeTruthy();
  await expect.element(layoutTitle() as HTMLElement).toBeVisible();
  expect(Math.abs(box(layoutTitle()).height - clipHeight)).toBeLessThanOrEqual(
    1,
  );
}, 60_000);

// The Clip widget's info icon fills most of its title slot, so its drawn
// circle reads at least as large as the power glyph of the neighboring Order
// device, expanded and folded.
test("the Clip widget's info icon is as large as a device's power glyph", async () => {
  await renderApp();
  await dropVideos(1);
  await expectCount(".source-span", 1);
  await userEvent.click(spans()[0]);

  const slotSelector =
    ".source-clip-properties__device .source-clip-properties__info";
  const powerSelector =
    'section[aria-label="Order"] .fx-device-panel__power svg path';
  await expect.poll(() => document.querySelector(slotSelector)).toBeTruthy();
  await expect.element(query(slotSelector)).toBeVisible();
  await expect.poll(() => document.querySelector(powerSelector)).toBeTruthy();
  await expect.element(query(powerSelector)).toBeVisible();
  const glyph = box(query(powerSelector));

  for (const folded of [false, true]) {
    if (folded) {
      const device = query(".source-clip-properties__device");
      await page
        .elementLocator(device)
        .getByRole("button", { name: "Collapse Clip", exact: false })
        .click();
      await expect
        .element(query(".source-clip-properties__device"))
        .toHaveClass(/fx-device-panel--collapsed/);
    }
    const drawn = box(query(`${slotSelector} svg path`));
    const bounds = box(query(slotSelector));
    expect(drawn.width).toBeGreaterThanOrEqual(glyph.width);
    expect(drawn.height).toBeGreaterThanOrEqual(glyph.height);
    expect(drawn.width).toBeGreaterThanOrEqual(bounds.width * 0.75);
  }
}, 60_000);

// Runs `callback` on the saved session record, in a readwrite transaction
// when `write` is set; resolves to what `callback` returns, or false while
// nothing is saved yet.
function withSavedSession(
  write: boolean,
  callback: (
    saved: { payload?: string } | undefined,
    store: IDBObjectStore,
    done: (result: boolean) => void,
    fail: (error: unknown) => void,
  ) => void,
) {
  return new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open("zvid-workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("sessions")) {
        database.close();
        resolve(false);
        return;
      }
      const store = database
        .transaction("sessions", write ? "readwrite" : "readonly")
        .objectStore("sessions");
      const get = store.get("current");
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        callback(
          get.result,
          store,
          (result) => {
            database.close();
            resolve(result);
          },
          (error) => {
            database.close();
            reject(error);
          },
        );
      };
    };
  });
}

// Waits until the autosave has written a session that mentions `text`.
async function waitForSavedSession(text: string) {
  await expect
    .poll(
      () =>
        withSavedSession(false, (saved, _store, done) =>
          done(saved?.payload?.includes(text) ?? false),
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
}

// The Clip widget leads its title with an info icon and folds to a strip like
// an FX device, by its chevron, a title double-click or the strip, and stays
// folded across selecting other clips and reloading.
test("the Clip widget collapses like an FX device and remembers it", async () => {
  let screen = await renderApp();
  await dropVideos(2);
  await expectCount(".source-span", 2);
  await userEvent.click(spans()[0]);

  const deviceSelector = ".source-clip-properties__device";
  const device = () => query(deviceSelector);
  await expect
    .poll(() =>
      document.querySelector(
        `${deviceSelector} .fx-device-panel__title .source-clip-properties__info svg`,
      ),
    )
    .toBeTruthy();
  await expect
    .element(
      query(
        `${deviceSelector} .fx-device-panel__title .source-clip-properties__info svg`,
      ),
    )
    .toBeVisible();
  const collapse = page
    .elementLocator(device())
    .getByRole("button", { name: "Collapse Clip", exact: false });
  await expect.element(collapse).toHaveAttribute("aria-expanded", "true");
  await collapse.click();

  const strip = () =>
    page
      .elementLocator(device())
      .getByRole("button", { name: "Expand Clip", exact: false });
  await expect.element(device()).toHaveClass(/fx-device-panel--collapsed/);
  await expect.element(strip()).toHaveAttribute("aria-expanded", "false");
  await expect
    .element(query(`${deviceSelector} .source-clip-properties__info svg`))
    .toBeVisible();
  await expect.poll(() => field("Start")).toBeNull();

  // Another clip's widget is folded too.
  await userEvent.click(spans()[1]);
  await expect.element(device()).toHaveClass(/fx-device-panel--collapsed/);

  // The fold survives a reload. The refresh restores the saved session, so
  // wait for it to hold both clips and check those rather than dropping more.
  await waitForSavedSession("test-pattern-1.mp4");
  screen = await reload(screen);
  await expectCount(".source-span", 2);
  await userEvent.click(spans()[0]);
  await expect.poll(() => document.querySelector(deviceSelector)).toBeTruthy();
  await expect.element(device()).toHaveClass(/fx-device-panel--collapsed/);

  await strip().click();
  await expect.element(device()).not.toHaveClass(/fx-device-panel--collapsed/);
  await expect.poll(() => field("Start")).not.toBeNull();
  await expect.element(fieldLocator("Start")).toBeVisible();

  // Double-clicking the title row folds it as well.
  await userEvent.dblClick(query(`${deviceSelector} .fx-device-panel__name`));
  await expect.element(device()).toHaveClass(/fx-device-panel--collapsed/);
}, 120_000);

// The Clip widget stacks Start, Length and Offset top to bottom, one per row,
// and is only as wide as one field. The Media offline warning wraps inside it
// rather than widening it.
test("the Clip widget stacks its fields vertically", async () => {
  await renderApp();
  await dropVideos(1);
  await expectCount(".source-span", 1);
  await userEvent.click(spans()[0]);

  await expect.poll(() => field("Offset")).not.toBeNull();
  await expect.element(fieldLocator("Offset")).toBeVisible();
  const device = query(".source-clip-properties__device");
  const [start, length, offset] = ["Start", "Length", "Offset"].map((name) =>
    box(field(name)),
  );
  expect(length.y).toBeGreaterThanOrEqual(start.y + start.height);
  expect(offset.y).toBeGreaterThanOrEqual(length.y + length.height);
  expect(Math.abs(length.x - start.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(offset.x - start.x)).toBeLessThanOrEqual(1);
  const width = box(device).width;
  expect(width).toBeLessThan(start.width * 2);

  // Show the warning the widget renders for offline media.
  const added = document.createElement("p");
  added.className = "fx-device-panel__warning";
  added.textContent =
    "Media offline: Length and Offset can't grow past their current values.";
  device.querySelector(".fx-device-panel__title")?.after(added);
  const warning = query(
    ".source-clip-properties__device .fx-device-panel__warning",
  );
  await expect.element(warning).toBeVisible();
  expect(box(device).width).toBeCloseTo(width, 0);
  const bounds = box(warning);
  const deviceBounds = box(device);
  expect(bounds.x).toBeGreaterThanOrEqual(deviceBounds.x);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(
    deviceBounds.x + deviceBounds.width,
  );
  expect(bounds.height).toBeGreaterThan(30);
}, 60_000);

// Sets the saved session's media length to `durationSeconds`; 0 is a session
// saved before its media's length was read.
async function rewriteSavedMedia(durationSeconds: number) {
  await expect
    .poll(
      () =>
        withSavedSession(true, (saved, store, done, fail) => {
          if (!saved?.payload?.includes("test-pattern-0.mp4")) {
            done(false);
            return;
          }
          let rewritten = false;
          const visit = (value: unknown) => {
            if (!value || typeof value !== "object") {
              return;
            }
            const record = value as Record<string, unknown>;
            if ("availability" in record && "durationSeconds" in record) {
              record.durationSeconds = durationSeconds;
              rewritten = true;
            }
            for (const child of Object.values(record)) {
              visit(child);
            }
          };
          const payload = JSON.parse(saved.payload);
          visit(payload);
          const put = store.put({
            ...saved,
            payload: JSON.stringify(payload),
          });
          put.onerror = () => fail(put.error);
          put.onsuccess = () => done(rewritten);
        }),
      { timeout: 10_000 },
    )
    .toBe(true);
}

// Waits until the media cache holds every media file of the saved session.
// The remount is much quicker than the spec's page reload and can otherwise
// hydrate the media before the import's cache write lands, finding nothing.
async function waitForCachedMedia() {
  await expect
    .poll(
      async () => {
        const { session } = await readSavedWorkspaceSession();
        const items = session?.history.present.mediaItems ?? [];
        const cached = await Promise.all(
          items.map((item) => getCachedMediaBlob(item.id)),
        );
        return items.length > 0 && cached.every(Boolean);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

const offlineWarning = ".source-clip-properties .fx-device-panel__warning";

// Media that plays but has no length recorded, as in a session saved before
// its files were read, is online: the Clip widget shows no Media offline
// warning, and Offset grows to the media's end once its length is read.
test("the Clip widget treats online media of unknown length as online", async () => {
  const screen = await renderApp();
  await dropVideos(1);
  await expectCount(".source-span", 1);
  await waitForCachedMedia();
  await rewriteSavedMedia(0);

  await reload(screen);
  await expectCount(".source-span", 1);
  await expect
    .poll(() => spans()[0]?.textContent ?? "", { timeout: 30_000 })
    .toMatch(/online/i);
  await userEvent.click(spans()[0]);
  await expect.poll(() => field("Offset")).not.toBeNull();
  await expect.element(fieldLocator("Offset")).toBeVisible();
  await expectCount(offlineWarning, 0);

  // Retries the drag until the media's length is read, as toPass does.
  const deadline = Date.now() + 15_000;
  for (;;) {
    await dragField("Offset", -200);
    try {
      await expect
        .poll(() => field("Offset")?.getAttribute("aria-valuenow"), {
          timeout: 1_000,
        })
        .toBe("8");
      break;
    } catch (error) {
      if (Date.now() > deadline) throw error;
    }
  }
  await expectCount(offlineWarning, 0);
}, 120_000);

// Media whose file is gone is offline: the Clip widget says so, and Offset
// can't grow past its current value.
test("the Clip widget warns when the media is offline", async () => {
  const screen = await renderApp();
  await dropVideos(1);
  await expectCount(".source-span", 1);
  await waitForCachedMedia();
  await rewriteSavedMedia(4);
  // Drop the cached media, so the reload can't restore the file.
  const root = await navigator.storage.getDirectory();
  for await (const name of (
    root as unknown as { keys(): AsyncIterable<string> }
  ).keys()) {
    await root.removeEntry(name, { recursive: true });
  }

  await reload(screen);
  await expectCount(".source-span", 1);
  await expect
    .poll(() => spans()[0]?.textContent ?? "", { timeout: 30_000 })
    .toMatch(/offline/i);
  await userEvent.click(spans()[0]);
  await expect
    .poll(
      () => document.querySelector(offlineWarning)?.textContent?.trim() ?? null,
    )
    .toBe(
      "Media offline: Length and Offset can't grow past their current values.",
    );
  await dragField("Offset", -200);
  await expectField("Offset", "aria-valuenow", "0");
}, 120_000);
