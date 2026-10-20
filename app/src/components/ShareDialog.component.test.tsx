import { useState } from "react";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ShareDialog } from "./ShareDialog";

// The Share dialog explains sharing in product terms and offers only Cancel
// and Start Sharing.

// Renders the open dialog, counting Start Sharing presses into `starts`.
async function renderDialog(isStarting = false) {
  const starts: number[] = [];
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <ShareDialog
        isStarting={isStarting}
        onOpenChange={setOpen}
        onStart={() => starts.push(1)}
        open={open}
      />
    );
  }
  await render(<Host />);
  return starts;
}

describe("ShareDialog", () => {
  test("shows only the title, a product description and the two buttons", async () => {
    await renderDialog();
    const dialog = page.getByRole("dialog", {
      name: "Share this session publicly?",
    });
    await expect.element(dialog).toBeVisible();
    await expect
      .element(dialog)
      .toHaveAccessibleDescription(
        /Anyone with the link can join and edit this session/,
      );
    const text = dialog.element().textContent ?? "";
    expect(text).toMatch(/Stop Share/);
    for (const term of [
      /websocket/i,
      /room/i,
      /signal/i,
      /fragment/i,
      /connection/i,
    ]) {
      expect(text).not.toMatch(term);
    }
    const buttons = [...dialog.element().querySelectorAll("button")].map(
      (button) => button.textContent?.trim(),
    );
    expect(buttons).toEqual(["Cancel", "Start Sharing"]);
  });

  test("Start Sharing starts sharing and Cancel closes without starting", async () => {
    const starts = await renderDialog();
    await userEvent.click(page.getByRole("button", { name: "Start Sharing" }));
    expect(starts).toHaveLength(1);
    await userEvent.click(page.getByRole("button", { name: "Cancel" }));
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(starts).toHaveLength(1);
  });

  test("disables both buttons while sharing starts", async () => {
    await renderDialog(true);
    await expect
      .element(page.getByRole("button", { name: "Starting..." }))
      .toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Cancel" }))
      .toBeDisabled();
  });
});
