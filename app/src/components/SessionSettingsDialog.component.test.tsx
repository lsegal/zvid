import { useState } from "react";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  DEFAULT_SESSION_SETTINGS,
  type SessionSettings,
} from "../session-settings";
import { SessionSettingsDialog } from "./SessionSettingsDialog";

// File ▸ Session Settings…'s dialog sets the session's canvas, frame rate and
// encoding, validates sizes, and opens on Ctrl/Cmd+,.

// Renders the dialog closed or open over the default 1920x1080, 30 fps
// session, recording what Apply reports.
async function renderDialog(initiallyOpen: boolean) {
  const applied: SessionSettings[] = [];
  function Host() {
    const [open, setOpen] = useState(initiallyOpen);
    return (
      <SessionSettingsDialog
        onApply={(settings) => applied.push(settings)}
        onOpenChange={setOpen}
        open={open}
        settings={DEFAULT_SESSION_SETTINGS}
      />
    );
  }
  await render(<Host />);
  return applied;
}

function dialog() {
  return page.getByRole("dialog", { name: "Session Settings" });
}

describe("SessionSettingsDialog", () => {
  test("Apply reports the chosen canvas preset and frame rate, then closes", async () => {
    const applied = await renderDialog(true);
    const settings = dialog();
    await expect.element(settings).toBeVisible();

    await settings.getByRole("combobox", { name: "Canvas preset" }).click();
    await page.getByRole("option", { name: "1080×1920 9:16" }).click();
    await expect
      .element(settings.getByLabelText("Canvas width"))
      .toHaveValue(1080);
    await expect
      .element(settings.getByLabelText("Canvas height"))
      .toHaveValue(1920);
    await settings.getByRole("combobox", { name: "Frame rate" }).click();
    await page.getByRole("option", { name: "60 fps", exact: true }).click();
    await settings.getByRole("button", { name: "Apply" }).click();

    await expect.element(settings).not.toBeInTheDocument();
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({
      canvasWidth: 1080,
      canvasHeight: 1920,
      fps: 60,
    });
  });

  test("validates sizes, and Cancel applies nothing", async () => {
    const applied = await renderDialog(true);
    const settings = dialog();

    await settings.getByRole("button", { name: "Unlock aspect ratio" }).click();
    await settings.getByLabelText("Canvas width").fill("1921");
    await expect
      .element(settings.getByText("Must be even for video encoders."))
      .toBeVisible();
    await expect
      .element(settings.getByRole("button", { name: "Apply" }))
      .toBeDisabled();

    await settings.getByRole("button", { name: "Cancel" }).click();
    await expect.element(settings).not.toBeInTheDocument();
    expect(applied).toEqual([]);
  });

  test("Ctrl+, opens it", async () => {
    await renderDialog(false);
    await expect.element(dialog()).not.toBeInTheDocument();
    await userEvent.keyboard("{Control>},{/Control}");
    await expect.element(dialog()).toBeVisible();
  });
});
