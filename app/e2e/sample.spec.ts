import { expect, type Page, test } from "@playwright/test";

// The zvid opening sample: File → Open Sample, and the sample opened on an
// empty start (`?sample=1`, since automation turns it off by default). Its
// media downloads from the app's own origin into the media cache before the
// sample opens, so nothing is ever left to locate.
const SAMPLE_MEDIA = "**/samples/opening-v1/*";

// Each load reads about 15 MB of media and analyses it.
test.describe.configure({ timeout: 120_000 });

async function openFileMenu(page: Page) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await expect(page.getByRole("menu").first()).toBeVisible();
}

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

async function expectSampleOpen(page: Page) {
  await expect(page.getByText("zvid opening sample").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Media linked")).toBeVisible({
    timeout: 60_000,
  });
  for (const id of ["orbit", "ribbon", "corridor", "order", "fx-regions"]) {
    await expect(lane(page, id)).toHaveCount(1);
  }
  await expect(
    page.getByRole("region", { name: "Main audio drop area" }),
  ).toContainText("decisions-30s.m4a");
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

  // A refresh restores the sample from the autosave and the media cache.
  await page.reload();
  await expectSampleOpen(page);
});

test("an empty start opens the sample on its own", async ({ page }) => {
  await page.goto("/?sample=1");
  await expectSampleOpen(page);
});

test("a failed download opens nothing until a retry succeeds", async ({
  page,
}) => {
  let failing = true;
  await page.route(SAMPLE_MEDIA, (route) =>
    failing ? route.abort("internetdisconnected") : route.continue(),
  );
  await page.goto("/");
  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Open Sample" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Could not open the sample");
  await expect(page.getByText("No source media yet")).toBeVisible();

  failing = false;
  await dialog.getByRole("button", { name: "Retry" }).click();
  await expectSampleOpen(page);
});

test("cancelling the download keeps the current project", async ({ page }) => {
  // Hold the media back so the load can be cancelled mid-way.
  await page.route(SAMPLE_MEDIA, () => {});
  await page.goto("/");
  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Open Sample" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("progressbar")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("No source media yet")).toBeVisible();
  await expect(lane(page, "orbit")).toHaveCount(0);
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
