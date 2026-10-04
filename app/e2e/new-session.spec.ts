import { expect, type Page, test } from "@playwright/test";

// File → New Session replaces the session with a blank project, asking
// first when the session has unsaved changes.

// Opening the sample reads about 15 MB of media and analyzes it.
test.describe.configure({ timeout: 120_000 });

async function openFileMenu(page: Page) {
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await expect(page.getByRole("menu").first()).toBeVisible();
}

async function chooseNewSession(page: Page) {
  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "New Session" }).click();
}

async function openSample(page: Page) {
  await page.goto("/");
  await expect(page.getByText("No source media yet")).toBeVisible();
  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Open", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sample", exact: true }).click();
  await expect(page.locator(".source-span").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator(".clip-card").first()).toBeVisible();
}

async function expectBlankSession(page: Page) {
  await expect(page.locator(".source-span")).toHaveCount(0);
  await expect(page.locator(".clip-card")).toHaveCount(0);
  await expect(page.getByText("No source media yet")).toBeVisible();
}

test("File → New Session asks to save, then opens a blank project", async ({
  page,
}) => {
  await openSample(page);

  await chooseNewSession(page);
  const prompt = page.getByRole("dialog", {
    name: "Save changes to this session?",
  });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Don't Save" }).click();
  await expect(prompt).toBeHidden();

  await expectBlankSession(page);
  await expect(page.getByText("Started a new session.")).toBeVisible();
  // The new session has no undo history.
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /^Undo/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");

  // The blank session is what a refresh restores.
  await page.reload();
  await expectBlankSession(page);
});

test("canceling the New Session prompt keeps the session", async ({ page }) => {
  await openSample(page);

  await chooseNewSession(page);
  const prompt = page.getByRole("dialog", {
    name: "Save changes to this session?",
  });
  await prompt.getByRole("button", { name: "Cancel" }).click();
  await expect(prompt).toBeHidden();

  await expect(page.locator(".source-span").first()).toBeVisible();
  await expect(page.locator(".clip-card").first()).toBeVisible();
});

test("File → New Session on a blank project doesn't ask", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("No source media yet")).toBeVisible();

  await chooseNewSession(page);

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectBlankSession(page);
  await expect(page.getByText("Started a new session.")).toBeVisible();
});

test("Save in the New Session prompt saves before starting over", async ({
  page,
}) => {
  const downloads: string[] = [];
  page.on("download", (download) => {
    downloads.push(download.suggestedFilename());
  });
  await openSample(page);
  const snap = page.getByRole("button", { name: /^Snap (On|Off)$/ });
  const snapped = await snap.getAttribute("aria-pressed");
  const edited = snapped === "true" ? "false" : "true";
  await snap.click();
  await expect(snap).toHaveAttribute("aria-pressed", edited);

  await chooseNewSession(page);
  await page
    .getByRole("dialog", { name: "Save changes to this session?" })
    .getByRole("button", { name: "Save", exact: true })
    .click();

  await expectBlankSession(page);
  await expect(page.getByText("Started a new session.")).toBeVisible();

  // The edit was saved into the Sessions library.
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  const saved = page
    .getByRole("list", { name: "Sessions" })
    .getByRole("button");
  await expect(saved).toHaveCount(1);
  await saved.click();
  await expect(page.locator(".clip-card").first()).toBeVisible();
  await expect(snap).toHaveAttribute("aria-pressed", edited);
  // Saving wrote no file.
  expect(downloads).toEqual([]);

  // The reopened entry has nothing unsaved, so New Session doesn't ask.
  await chooseNewSession(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectBlankSession(page);
});

test("a failed save in the New Session prompt keeps the session", async ({
  page,
}) => {
  await openSample(page);
  // Writing a Sessions entry fails from here on.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "entries") {
        throw new DOMException("The disk is full.", "QuotaExceededError");
      }
      return put.apply(this, args);
    };
  });

  await chooseNewSession(page);
  await page
    .getByRole("dialog", { name: "Save changes to this session?" })
    .getByRole("button", { name: "Save", exact: true })
    .click();

  await expect(page.getByText("Save failed: The disk is full.")).toBeVisible();
  await expect(page.locator(".source-span").first()).toBeVisible();
  await expect(page.locator(".clip-card").first()).toBeVisible();
});

test("exporting doesn't count as saving for New Session", async ({ page }) => {
  // Exporting downloads instead of asking where to save.
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await openSample(page);
  await openFileMenu(page);
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: "Project…", exact: true }).click();
  expect((await downloading).suggestedFilename()).toMatch(/\.zvd$/);

  await chooseNewSession(page);
  await expect(
    page.getByRole("dialog", { name: "Save changes to this session?" }),
  ).toBeVisible();
});
