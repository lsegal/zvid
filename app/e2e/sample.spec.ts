import { expect, type Page, test } from "@playwright/test";

// The zvid opening sample: File → Open Sample, and the sample opened on an
// empty start (`?sample=1`, since automation turns it off by default). The
// sample opens at once and its media downloads from the app's own origin
// into the media cache in place, through the same skeletons, status and
// Media Sync dialog as media syncing from a peer.
const SAMPLE_MEDIA = "**/samples/opening-v1/*";

// Each load reads about 15 MB of media and analyzes it.
test.describe.configure({ timeout: 120_000 });

async function openFileMenu(page: Page) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await expect(page.getByRole("menu").first()).toBeVisible();
}

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

async function expectSampleOpen(page: Page) {
  await expect(page.getByText("Media linked")).toBeVisible({
    timeout: 60_000,
  });
  for (const id of ["orbit", "ribbon", "corridor", "order", "fx-regions"]) {
    await expect(lane(page, id)).toHaveCount(1);
  }
  // Its old main audio opens as a source track; the Audio row shows the
  // resolved mix.
  await expect(page.locator("[data-audio-row]")).toContainText(
    /From (source tracks|layers) · \d+ clips?/,
  );
  await expect(
    page.getByRole("menuitem", { name: /Locate Offline Media/ }),
  ).toHaveCount(0);
}

test("File → Open Sample opens the editable sample with all its media", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("No source media yet")).toBeVisible();

  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Open Sample" }).click();
  await expectSampleOpen(page);
  await expect(
    page.getByText("zvid opening sample", { exact: true }).first(),
  ).toBeVisible();

  // A refresh restores the sample from the autosave and the media cache.
  await page.reload();
  await expectSampleOpen(page);
});

test("an empty start opens the sample on its own", async ({ page }) => {
  await page.goto("/?sample=1");
  await expectSampleOpen(page);
});

test("the sample opens at once and loads its media in place", async ({
  page,
}) => {
  // Hold the media back until the open session has been checked.
  const held: (() => Promise<void>)[] = [];
  let holding = true;
  await page.route(SAMPLE_MEDIA, (route) => {
    if (holding) {
      held.push(() => route.continue());
    } else {
      void route.continue();
    }
  });
  await page.goto("/");
  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Open Sample" }).click();

  for (const id of ["orbit", "ribbon", "corridor"]) {
    await expect(lane(page, id)).toHaveCount(1);
  }
  await expect(page.locator(".clip-card.is-syncing").first()).toBeVisible();
  const status = page.getByRole("button", {
    name: /^Loading \d+ of \d+ media files…/,
  });
  await expect(status).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await status.click();
  const dialog = page.getByRole("dialog", { name: "Media Sync" });
  await expect(dialog).toContainText("from Sample");
  await expect(dialog).toContainText("loaded");

  holding = false;
  for (const release of held.splice(0)) {
    await release();
  }
  await expectSampleOpen(page);
  await expect(page.locator(".clip-card.is-syncing")).toHaveCount(0);
});

test("a failed download can be retried from the Media Sync dialog", async ({
  page,
}) => {
  let failing = true;
  await page.route(SAMPLE_MEDIA, (route) =>
    failing ? route.abort("internetdisconnected") : route.continue(),
  );
  await page.goto("/");
  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Open Sample" }).click();

  // The session is open; its media is what failed.
  await expect(lane(page, "orbit")).toHaveCount(1);
  const offline = page.getByRole("button", { name: /offline media files?$/ });
  await expect(offline).toBeVisible({ timeout: 60_000 });
  await offline.click();
  const dialog = page.getByRole("dialog", { name: "Media Sync" });
  await expect(dialog).toContainText("could not be downloaded");

  failing = false;
  const retry = dialog.getByRole("button", { name: "Retry" });
  while ((await retry.count()) > 0) {
    await retry.first().click();
  }
  await expectSampleOpen(page);
});

test("reopening the sample after a failed download tries it again", async ({
  page,
}) => {
  let failing = true;
  await page.route(SAMPLE_MEDIA, (route) =>
    failing ? route.abort("internetdisconnected") : route.continue(),
  );
  await page.goto("/");
  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Open Sample" }).click();
  await expect(
    page.getByRole("button", { name: /offline media files?$/ }),
  ).toBeVisible({ timeout: 60_000 });

  failing = false;
  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Close Session" }).click();
  await expect(page.getByText("No source media yet")).toBeVisible();
  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Open Sample" }).click();
  await expectSampleOpen(page);
});

test("closing the session stops the sample's downloads", async ({ page }) => {
  // Hold the media back so the session can be closed mid-way.
  await page.route(SAMPLE_MEDIA, () => {});
  await page.goto("/");
  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Open Sample" }).click();
  await expect(lane(page, "orbit")).toHaveCount(1);

  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Close Session" }).click();
  await expect(page.getByText("No source media yet")).toBeVisible();
  await expect(lane(page, "orbit")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Loading \d+ of/ }),
  ).toHaveCount(0);
});

test("a saved copy of the sample reopens with its media still linked", async ({
  page,
}) => {
  // Save downloads instead of asking where to save.
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/?sample=1");
  await expectSampleOpen(page);

  await openFileMenu(page);
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Save", exact: true }).click();
  const saved = await (await downloading).path();
  expect(saved).toBeTruthy();

  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Close Session" }).click();
  await expect(page.getByText("No source media yet")).toBeVisible();

  const choosing = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Open Session" }).click();
  await (await choosing).setFiles({
    name: "zvid opening sample.lvp",
    mimeType: "application/json",
    buffer: (await import("node:fs")).readFileSync(saved as string),
  });
  await expectSampleOpen(page);
});
