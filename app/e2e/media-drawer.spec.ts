import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// The Media drawer at the left of the timeline lists every linked media item
// in an icon or list view, with search, a thumbnail size slider, the item
// count and selection, and remembers its state per viewer.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);
const TONE = new URL("./fixtures/tone.wav", import.meta.url);
const SAMPLE_MEDIA = "**/samples/opening-v1/*";

async function dropFile(
  page: Page,
  target: string,
  file: URL,
  name: string,
  type: string,
) {
  const base64 = (await readFile(file)).toString("base64");
  const dataTransfer = await page.evaluateHandle(
    ({ data, name, type }) => {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type }));
      return transfer;
    },
    { data: base64, name, type },
  );
  for (const event of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, event, { dataTransfer });
  }
}

// A video in a new source track and a WAV as the main audio.
async function linkMedia(page: Page) {
  await dropFile(
    page,
    '[data-source-track-drop-target="new-track"]',
    VIDEO,
    "test-pattern.mp4",
    "video/mp4",
  );
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
  await dropFile(
    page,
    "[data-main-audio-drop-target]",
    TONE,
    "tone.wav",
    "audio/wav",
  );
  await expect(
    page.locator("[data-main-audio-drop-target] .track-label small"),
  ).toHaveText("tone.wav", { timeout: 30_000 });
}

function drawer(page: Page) {
  return page.getByRole("complementary", { name: "Media" });
}

function toggle(page: Page) {
  return page.getByRole("button", { name: "Media", exact: true });
}

function items(page: Page) {
  return drawer(page).getByRole("option");
}

test("the drawer is collapsed by default and opens and closes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(drawer(page)).toBeHidden();

  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page)).toContainText("No media yet");
  await expect(
    drawer(page).getByRole("button", { name: "Import Media" }),
  ).toBeVisible();
  await expect(drawer(page)).toContainText("0 items");
  // The timeline gives up the drawer's width.
  const box = await drawer(page).boundingBox();
  expect(box?.width).toBeGreaterThan(200);

  await drawer(page)
    .getByRole("button", { name: "Close media drawer" })
    .click();
  await expect(drawer(page)).toBeHidden();
  await toggle(page).click();
  await expect(drawer(page)).toBeVisible();
  await toggle(page).click();
  await expect(drawer(page)).toBeHidden();
});

test("lists, searches, sizes and selects linked media, and remembers its state", async ({
  page,
}) => {
  await page.goto("/");
  await linkMedia(page);
  await toggle(page).click();

  // Both media items are listed, the main audio marked as the audio track.
  await expect(items(page)).toHaveCount(2);
  await expect(drawer(page)).toContainText("2 items");
  const video = items(page).filter({ hasText: "test-pattern" });
  const tone = items(page).filter({ hasText: "tone" });
  await expect(tone).toContainText("Audio track");
  await expect(video).not.toContainText("Audio track");

  // Search narrows the items and the count.
  const search = drawer(page).getByRole("textbox", { name: "Search media" });
  await search.fill("TONE");
  await expect(items(page)).toHaveCount(1);
  await expect(drawer(page)).toContainText("1 of 2 items");
  await search.fill("nothing like it");
  await expect(items(page)).toHaveCount(0);
  await expect(drawer(page)).toContainText("0 of 2 items");
  await drawer(page).getByRole("button", { name: "Clear search" }).click();
  await expect(search).toHaveValue("");
  await expect(items(page)).toHaveCount(2);
  await expect(drawer(page)).toContainText("2 items");

  // The slider scales the icon view's tiles.
  const slider = drawer(page).getByRole("slider", { name: "Thumbnail size" });
  await slider.fill("64");
  const small = (await video.boundingBox())?.width ?? 0;
  await slider.fill("200");
  const large = (await video.boundingBox())?.width ?? 0;
  expect(large).toBeGreaterThan(small + 100);

  // Click selects one item; arrows, Home and End move the selection.
  await video.click();
  await expect(video).toHaveAttribute("aria-selected", "true");
  await expect(tone).toHaveAttribute("aria-selected", "false");
  const listbox = drawer(page).getByRole("listbox");
  await expect(listbox).toBeFocused();
  await page.keyboard.press("End");
  await expect(tone).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(video).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(tone).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(video).toHaveAttribute("aria-selected", "true");

  // The list view shows Kind and Duration columns.
  await drawer(page).getByRole("button", { name: "List" }).click();
  await expect(
    drawer(page).getByRole("button", { name: "List" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(video).toHaveClass(/media-row/);
  await expect(video.locator(".media-row__kind")).toHaveText(/^Video/);
  await expect(tone.locator(".media-row__kind")).toHaveText("Audio");
  await expect(video).toHaveAttribute("aria-selected", "true");
  await listbox.focus();
  await page.keyboard.press("ArrowDown");
  await expect(tone).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(video).toHaveAttribute("aria-selected", "true");

  // The open state, view and thumbnail size persist across a reload.
  await page.reload();
  await expect(drawer(page)).toBeVisible();
  await expect(
    drawer(page).getByRole("button", { name: "List" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    drawer(page).getByRole("slider", { name: "Thumbnail size" }),
  ).toHaveValue("200");
});

test("the resize handle widens the drawer and double-click resets it", async ({
  page,
}) => {
  await page.goto("/");
  await toggle(page).click();
  const handle = page.getByRole("separator", { name: "Resize media drawer" });
  await expect(handle).toBeVisible();
  const before = (await drawer(page).boundingBox())?.width ?? 0;

  const box = await handle.boundingBox();
  if (!box) throw new Error("no handle");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, {
    steps: 4,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await drawer(page).boundingBox())?.width ?? 0)
    .toBeGreaterThan(before + 60);

  await handle.dblclick();
  await expect
    .poll(async () => (await drawer(page).boundingBox())?.width ?? 0)
    .toBeLessThan(before + 4);
});

test("offline media is marked", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route(SAMPLE_MEDIA, (route) =>
    route.abort("internetdisconnected"),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Open Sample" }).click();
  await expect(
    page.getByRole("button", { name: /offline media files?$/ }),
  ).toBeVisible({ timeout: 60_000 });

  await toggle(page).click();
  const offline = items(page).filter({ hasText: "Offline" });
  await expect(offline.first()).toBeVisible();
  await expect(offline.first()).toHaveAttribute("data-availability", "offline");
  await expect(offline.first()).toHaveClass(/is-offline/);
  await expect(drawer(page).locator(".media-badge--audio-track")).toHaveCount(
    1,
  );
});

test("overlays the timeline as a sheet on narrow layouts", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto("/");
  await expect(drawer(page)).toBeHidden();

  await toggle(page).click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page)).toHaveCSS("position", "fixed");
  await expect(
    page.getByRole("separator", { name: "Resize media drawer" }),
  ).toBeHidden();
  // It slides in to the viewport's left edge, over the timeline.
  await expect.poll(async () => (await drawer(page).boundingBox())?.x).toBe(0);
  const box = await drawer(page).boundingBox();
  expect(box?.y).toBe(0);
  expect(box?.width).toBeLessThanOrEqual(720);

  await drawer(page)
    .getByRole("button", { name: "Close media drawer" })
    .click();
  await expect(drawer(page)).toBeHidden();
});
