import { useState } from "react";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  ProjectExportDialog,
  type ProjectExportOptions,
} from "./ProjectExportDialog";

// File ▸ Export Project's dialog: it reports the Include media files choice
// to onExport, and Cancel, Escape and the close paths call onCancel instead.

type Calls = { exports: ProjectExportOptions[]; cancels: number };

// Opens the dialog with the checkbox starting at initialIncludeMedia. The
// callbacks record their calls and close the dialog, as the app does; the
// Reopen button opens it again.
async function openDialog(initialIncludeMedia: boolean) {
  const calls: Calls = { exports: [], cancels: 0 };
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button onClick={() => setOpen(true)} type="button">
          Reopen
        </button>
        <ProjectExportDialog
          initialIncludeMedia={initialIncludeMedia}
          onCancel={() => {
            calls.cancels += 1;
            setOpen(false);
          }}
          onExport={(options) => {
            calls.exports.push(options);
            setOpen(false);
          }}
          open={open}
        />
      </>
    );
  }
  const screen = await render(<Host />);
  const dialog = page.getByRole("dialog", { name: "Export Project" });
  await expect.element(dialog).toBeVisible();
  const checkbox = dialog.getByRole("checkbox", {
    name: "Include media files",
  });
  return { calls, checkbox, dialog, screen };
}

describe("ProjectExportDialog", () => {
  test("Export reports the checked Include media files box", async () => {
    const { calls, checkbox, dialog } = await openDialog(false);
    await expect.element(checkbox).not.toBeChecked();

    await checkbox.click();
    await dialog.getByRole("button", { name: "Export" }).click();

    await expect.element(dialog).not.toBeInTheDocument();
    expect(calls).toEqual({ exports: [{ includeMedia: true }], cancels: 0 });
  });

  test("can be used from the keyboard", async () => {
    const { calls, checkbox, dialog } = await openDialog(true);
    await expect.element(checkbox).toHaveFocus();
    await expect.element(checkbox).toBeChecked();

    await userEvent.keyboard(" ");
    await expect.element(checkbox).not.toBeChecked();
    await userEvent.tab();
    await userEvent.tab();
    await expect
      .element(dialog.getByRole("button", { name: "Export" }))
      .toHaveFocus();
    await userEvent.keyboard("{Enter}");

    await expect.element(dialog).not.toBeInTheDocument();
    expect(calls).toEqual({ exports: [{ includeMedia: false }], cancels: 0 });
  });

  test("Cancel and Escape close it without exporting", async () => {
    const { calls, checkbox, dialog, screen } = await openDialog(false);
    await checkbox.click();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(calls).toEqual({ exports: [], cancels: 1 });

    // Reopening starts from the initial value again.
    await screen.getByRole("button", { name: "Reopen" }).click();
    await expect.element(dialog).toBeVisible();
    await expect.element(checkbox).not.toBeChecked();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).not.toBeInTheDocument();
    expect(calls).toEqual({ exports: [], cancels: 2 });
  });
});
