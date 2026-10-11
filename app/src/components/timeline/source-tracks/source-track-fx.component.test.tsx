import { expect, test } from "vitest";
import { type Locator, page, userEvent } from "vitest/browser";
import {
  dropFiles,
  expectCount,
  fileTransfer,
  fixtureFile,
  pressMod,
  query,
  queryAll,
  renderApp,
} from "../../../component-test/app.tsx";
import { setViewport } from "../../../component-test/viewport.ts";

// Source tracks and source clips have their own effect stacks. Selecting a
// source clip shows its Clip Properties, then the Global, Track and Clip
// sections; selecting a source track shows Global and Track. With no layer
// clips, the preview renders the source tracks with those stacks.

const VIEWPORT = { width: 1600, height: 1200 } as const;

// Ctrl on Linux and Windows, Cmd on macOS, as Playwright's ControlOrMeta.
async function addSourceVideo() {
  await dropFiles(
    query('[data-source-track-drop-target="new-track"]'),
    fileTransfer([await fixtureFile("test-pattern.mp4")]),
  );
  await expectCount(".source-span", 1);
}

// The preview's pixels, downsampled to a 16×16 grid of RGB values.
async function previewPixels() {
  const base64 = await page.screenshot({
    element: query(".preview-monitor canvas"),
    save: false,
  });
  const image = new Image();
  image.src = `data:image/png;base64,${base64}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2D context");
  context.drawImage(image, 0, 0, 16, 16);
  return Array.from(context.getImageData(0, 0, 16, 16).data).filter(
    (_, index) => index % 4 !== 3,
  );
}

// The mean per-channel difference between two samples, 0-255.
function difference(a: number[], b: number[]) {
  let sum = 0;
  for (const [index, value] of a.entries()) {
    sum += Math.abs(value - b[index]);
  }
  return sum / a.length;
}

// Waits for the preview to settle on a frame different from `before`, and
// returns it.
async function expectPreviewChange(before: number[]) {
  let after = before;
  await expect
    .poll(
      async () => {
        after = await previewPixels();
        return difference(before, after);
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(4);
  return after;
}

// Focuses a menu item and opens its submenu, as Playwright's press does.
async function openSubmenu(item: Locator) {
  await expect.element(item).toBeVisible();
  item.element().focus();
  await userEvent.keyboard("{ArrowRight}");
}

async function addDevice(button: Locator, category: string, name: string) {
  await button.click();
  await openSubmenu(
    page.getByRole("menuitem", { name: category, exact: true }),
  );
  await page.getByRole("menuitem", { name: new RegExp(`^${name}`) }).click();
}

// Clip-mode Animation, on for a new device, eases an effect in from the
// clip's start, where the playhead is; switching it off shows the effect
// as set.
async function turnAnimationOff(group: "layer" | "clip") {
  await page
    .elementLocator(query(`.fx-chain [data-fx-group="${group}"]`))
    .getByRole("button", { name: /^Turn Animation Off/ })
    .click();
}

// Text as Playwright's toHaveText compares it, whitespace normalized.
function text(element: Element) {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

const dividers = ".fx-chain [data-fx-divider]";

function dividerTexts() {
  return queryAll(dividers).map(text);
}

test("source tracks and clips have their own effects, rendered in the preview", async () => {
  await setViewport(VIEWPORT);
  await renderApp();
  await addSourceVideo();
  await expect
    .element(query(".preview-monitor"))
    .toHaveAttribute("data-render-source", "source-tracks");
  await expectCount(".preview-placeholder", 0);
  // A dropped file names its new source track.
  const trackName = "test-pattern";

  // A source track shows Global and its own Track stack.
  await userEvent.click(query(".track-label--source"));
  await expect.poll(dividerTexts).toEqual(["Global", "Track"]);
  await expect
    .poll(() => text(query(".fx-panel__toggle")))
    .toBe(`${trackName} Effects`);
  await expectCount(".source-clip-properties", 0);
  // An empty Track section shows the same compact add tile as the others.
  await expectCount(".fx-chain__empty", 0);
  await expect
    .element(query('.fx-chain [data-fx-focus="add-layer"]'))
    .toBeVisible();

  // An effect on the source track renders on it.
  const plain = await previewPixels();
  await page
    .getByRole("button", { name: "Add device to this track", exact: false })
    .first()
    .click();
  const menu = page.getByRole("menu").first();
  const submenu = page.getByRole("menu").last();
  // The track's menu offers a layer's effects: Transform but not Order.
  await openSubmenu(
    menu.getByRole("menuitem", { name: "Transform", exact: true }),
  );
  await expect
    .element(submenu.getByRole("menuitem", { name: /^Transform/ }))
    .toBeVisible();
  await expect
    .poll(() => submenu.getByRole("menuitem", { name: /^Order/ }).all())
    .toHaveLength(0);
  await openSubmenu(
    menu.getByRole("menuitem", { name: "Stylize", exact: false }),
  );
  await submenu
    .getByRole("menuitem", { name: "Negative Split", exact: false })
    .click();
  await expectCount('.fx-chain [data-fx-group="layer"]', 1);
  await turnAnimationOff("layer");
  const withTrack = await expectPreviewChange(plain);

  // A source clip shows the track's Record device, its Clip Properties,
  // then Global, Track and Clip.
  await userEvent.click(query(".source-span"));
  await expect
    .poll(() => text(query(".fx-panel__toggle")))
    .toMatch(new RegExp(`^Clip .+ Effects \\(${trackName}\\)$`));
  const chain = query(".fx-chain");
  await expect
    .poll(() => chain.querySelector(":scope > *")?.className)
    .toMatch(/track-record-device/);
  await expect
    .poll(() => chain.querySelectorAll(":scope > *")[1]?.className)
    .toMatch(/source-clip-properties/);
  await expect.poll(dividerTexts).toEqual(["Global", "Track", "Clip"]);
  const properties = chain.querySelector(".source-clip-properties");
  const global = chain.querySelector('[data-fx-divider="global"]');
  const order =
    properties && global
      ? Boolean(
          properties.compareDocumentPosition(global) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        )
      : false;
  expect(order).toBe(true);
  // The track's effect shows in the Track section.
  await expectCount('.fx-chain [data-fx-group="layer"]', 1);

  // An effect on the source clip renders too, along with the track's: half
  // a turn of hue on the test pattern's colors.
  await addDevice(
    page.getByRole("button", { name: "Add device to this clip", exact: false }),
    "Color",
    "Colorize",
  );
  await expectCount('.fx-chain [data-fx-group="clip"]', 1);
  await turnAnimationOff("clip");
  const clipDevice = page.elementLocator(
    query('.fx-chain [data-fx-group="clip"]'),
  );
  const hue = clipDevice.getByRole("button", { name: /^Hue Shift: / });
  await expect.element(hue).toBeVisible();
  hue.element().focus();
  await userEvent.keyboard("{Enter}");
  await clipDevice.getByRole("textbox").fill("0.5");
  await userEvent.keyboard("{Enter}");
  await expect
    .element(
      clipDevice.getByRole("button", {
        name: "Hue Shift: +180°. Edit value",
        exact: false,
      }),
    )
    .toBeVisible();
  await expectPreviewChange(withTrack);

  // Undo removes the clip's effect (after its Hue Shift and Animation edits),
  // leaving the track's.
  query(".fx-panel__toggle").focus();
  for (let step = 0; step < 3; step += 1) {
    await pressMod("z");
  }
  await expectCount('.fx-chain [data-fx-group="clip"]', 0);
  await expectCount('.fx-chain [data-fx-group="layer"]', 1);
  await expect
    .poll(async () => difference(withTrack, await previewPixels()), {
      timeout: 15_000,
    })
    .toBeLessThan(4);
}, 120_000);
