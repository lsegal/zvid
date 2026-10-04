import { expect, type Page, test } from "@playwright/test";

// File ▸ Export Project's dialog, rendered on its own: it reports the
// Include media files choice to onExport, and Cancel, Escape and the close
// paths call onCancel instead.

type Calls = { exports: Array<{ includeMedia: boolean }>; cancels: number };

// Opens the dialog with the checkbox starting at initialIncludeMedia. The
// callbacks record their calls and close the dialog, as the app will;
// window.reopenProjectExport opens it again.
async function openDialog(page: Page, initialIncludeMedia: boolean) {
  await page.goto("/export-smoke.html");
  await page.evaluate(async (initialIncludeMedia) => {
    // Variables keep TypeScript from resolving the dev server's paths.
    const paths = {
      mount: "/e2e/fixtures/mount.ts",
      dialog: "/src/components/ProjectExportDialog.tsx",
    };
    const { mount } = await import(/* @vite-ignore */ paths.mount);
    const { ProjectExportDialog } = await import(
      /* @vite-ignore */ paths.dialog
    );
    const target = window as unknown as {
      projectExportCalls: Calls;
      reopenProjectExport: () => void;
    };
    const calls: Calls = { exports: [], cancels: 0 };
    target.projectExportCalls = calls;
    const props = (open: boolean) => ({
      open,
      initialIncludeMedia,
      onExport: (options: { includeMedia: boolean }) => {
        calls.exports.push(options);
        view.render(props(false));
      },
      onCancel: () => {
        calls.cancels += 1;
        view.render(props(false));
      },
    });
    const view = mount(ProjectExportDialog, props(true));
    target.reopenProjectExport = () => view.render(props(true));
  }, initialIncludeMedia);
  const dialog = page.getByRole("dialog", { name: "Export Project" });
  await expect(dialog).toBeVisible();
  return dialog;
}

function calls(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { projectExportCalls: Calls }).projectExportCalls,
  );
}

test("Export reports the checked Include media files box", async ({ page }) => {
  const dialog = await openDialog(page, false);
  const checkbox = dialog.getByRole("checkbox", {
    name: "Include media files",
  });
  await expect(checkbox).not.toBeChecked();

  await checkbox.check();
  await dialog.getByRole("button", { name: "Export" }).click();

  await expect(dialog).toBeHidden();
  expect(await calls(page)).toEqual({
    exports: [{ includeMedia: true }],
    cancels: 0,
  });
});

test("the dialog can be used from the keyboard", async ({ page }) => {
  const dialog = await openDialog(page, true);
  const checkbox = dialog.getByRole("checkbox", {
    name: "Include media files",
  });
  await expect(checkbox).toBeFocused();
  await expect(checkbox).toBeChecked();

  await page.keyboard.press("Space");
  await expect(checkbox).not.toBeChecked();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Export" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(dialog).toBeHidden();
  expect(await calls(page)).toEqual({
    exports: [{ includeMedia: false }],
    cancels: 0,
  });
});

test("Cancel and Escape close the dialog without exporting", async ({
  page,
}) => {
  const dialog = await openDialog(page, false);
  await dialog.getByRole("checkbox", { name: "Include media files" }).check();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(await calls(page)).toEqual({ exports: [], cancels: 1 });

  // Reopening starts from the initial value again.
  await page.evaluate(() =>
    (
      window as unknown as { reopenProjectExport: () => void }
    ).reopenProjectExport(),
  );
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", { name: "Include media files" }),
  ).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await calls(page)).toEqual({ exports: [], cancels: 2 });
});
