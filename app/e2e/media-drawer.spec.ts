import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Kept in Playwright: real-file details, offline sample media and reloads need the whole app; MediaDrawer.component.test.tsx covers the rest.
// The Media drawer remembers its state per viewer, shows the selected media's
// file details, and marks offline media.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);
const TONE = new URL("./fixtures/tone.wav", import.meta.url);
const SAMPLE_MEDIA = "**/samples/opening-v2/*";

async function dropFile(
  page: Page,
  target: string,
  file: URL,
  name: string,
  type: string,
  // Shown only while a drag is over it, as the new-track row is.
  over?: string,
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
  if (over) {
    for (const event of ["dragenter", "dragover"]) {
      await page.dispatchEvent(over, event, { dataTransfer });
    }
  }
  for (const event of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, event, { dataTransfer });
  }
}

// A video and a WAV, each in a new source track.
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
  // A second track goes on the new-track row that dragging over a track
  // shows.
  await dropFile(
    page,
    ".track-row--source-drop",
    TONE,
    "tone.wav",
    "audio/wav",
    '[data-source-track-drop-target="track"]',
  );
  await expect(page.locator(".source-span")).toHaveCount(2, {
    timeout: 30_000,
  });
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

test("the drawer remembers its state across a reload", async ({ page }) => {
  await page.goto("/");
  await toggle(page).click();
  await drawer(page).getByRole("button", { name: "List" }).click();
  await drawer(page)
    .getByRole("slider", { name: "Thumbnail size" })
    .fill("200");

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

function details(page: Page) {
  return drawer(page).getByRole("region", { name: "Media details" });
}

// The details pane's value for a key, like "Size".
function detail(page: Page, label: string) {
  return details(page)
    .locator(".media-details__row")
    .filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) })
    .locator("dd");
}

test("the details pane shows the selected media's file details", async ({
  page,
}) => {
  await page.goto("/");
  await linkMedia(page);
  await toggle(page).click();
  await expect(details(page)).toContainText("No media selected");

  // A video shows its size, container, codec, dimensions and fps.
  await items(page).filter({ hasText: "test-pattern" }).click();
  await expect(detail(page, "Name")).toHaveText("test-pattern.mp4");
  await expect(detail(page, "Kind")).toHaveText(/^Video/);
  await expect(detail(page, "Size")).toHaveText(/^[\d.]+ (B|KB|MB)$/);
  await expect(detail(page, "Container")).toHaveText("MP4");
  await expect(detail(page, "Video")).toHaveText(/\d+ × \d+ · [\d.]+ fps/);
  await expect(detail(page, "Duration")).not.toHaveText("—");
  await expect(detail(page, "Bitrate")).toHaveText(/ (kbps|Mbps)$/);
  await expect(detail(page, "Modified")).not.toHaveText("—");
  await expect(details(page).locator(".media-thumb")).toBeVisible();

  // An audio-only item hides the video rows.
  await items(page).filter({ hasText: "tone" }).click();
  await expect(detail(page, "Name")).toHaveText("tone.wav");
  await expect(detail(page, "Kind")).toHaveText("Audio");
  await expect(detail(page, "Container")).toHaveText("WAV");
  await expect(detail(page, "Audio")).toHaveText(/kHz/);
  await expect(detail(page, "Video")).toHaveCount(0);

  // The pane collapses, and stays collapsed across a reload.
  const toggleDetails = details(page).getByRole("button", { name: "Details" });
  await expect(toggleDetails).toHaveAttribute("aria-expanded", "true");
  await toggleDetails.click();
  await expect(toggleDetails).toHaveAttribute("aria-expanded", "false");
  await expect(details(page).locator("dl")).toHaveCount(0);
  await page.reload();
  await expect(
    details(page).getByRole("button", { name: "Details" }),
  ).toHaveAttribute("aria-expanded", "false");
});

test("offline media is marked", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route(SAMPLE_MEDIA, (route) =>
    route.abort("internetdisconnected"),
  );
  await page.goto("/");
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Open", exact: true }).click();
  await page.getByRole("menuitem", { name: "Samples", exact: true }).click();
  await page.getByRole("menuitem", { name: "Default", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /offline media files?$/ }),
  ).toBeVisible({ timeout: 60_000 });

  await toggle(page).click();
  const offline = items(page).filter({ hasText: "Offline" });
  await expect(offline.first()).toBeVisible();
  await expect(offline.first()).toHaveAttribute("data-availability", "offline");
  await expect(offline.first()).toHaveClass(/is-offline/);

  // Its details keep what was stored and show that it is offline.
  await offline.first().click();
  await expect(detail(page, "Status")).toHaveText("Offline");
  await expect(detail(page, "Name")).not.toHaveText("—");
});
