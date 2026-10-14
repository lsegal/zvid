import { useState } from "react";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  DEFAULT_SESSION_SETTINGS,
  type SessionSettings,
} from "../session-settings";
import {
  type SessionLength,
  SessionSettingsDialog,
} from "./SessionSettingsDialog";

// File ▸ Session Settings…'s dialog sets the session's canvas, frame rate,
// length and encoding, validates sizes, and opens on Ctrl/Cmd+,.

// At 120 BPM in 4/4, content ending after two bars, at 4 s.
const DETECTED: SessionLength = {
  bpm: 120,
  signature: { numerator: 4, denominator: 4 },
  detectedQ: 8,
};

// Renders the dialog closed or open over the default 1920x1080, 30 fps
// session, recording what Apply reports: the settings, and the lengths into
// `lengths`.
async function renderDialog(
  initiallyOpen: boolean,
  length: SessionLength = DETECTED,
  lengths: (number | undefined)[] = [],
) {
  const applied: SessionSettings[] = [];
  function Host() {
    const [open, setOpen] = useState(initiallyOpen);
    return (
      <SessionSettingsDialog
        length={length}
        onApply={(settings, lengthQ) => {
          applied.push(settings);
          lengths.push(lengthQ);
        }}
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

  test("shows the session length in beats and timecode, sets it, and unsets it", async () => {
    const lengths: (number | undefined)[] = [];
    await renderDialog(true, DETECTED, lengths);
    const settings = dialog();
    const beats = settings.getByRole("spinbutton", { name: "Beats" });
    const timecode = settings.getByRole("spinbutton", { name: "Timecode" });
    await expect.element(beats).toHaveTextContent("2.0.0");
    await expect.element(timecode).toHaveTextContent("00:04:00");
    await expect
      .element(settings.getByRole("button", { name: "Unset" }))
      .toBeDisabled();

    // Typing a length in beats updates the timecode, and the reverse.
    await beats.getByRole("button").click();
    await beats.getByRole("textbox").fill("4.0.0");
    await userEvent.keyboard("{Enter}");
    await expect.element(timecode).toHaveTextContent("00:08:00");
    await timecode.getByRole("button").click();
    await timecode.getByRole("textbox").fill("00:10:00");
    await userEvent.keyboard("{Enter}");
    await expect.element(beats).toHaveTextContent("5.0.0");
    await settings.getByRole("button", { name: "Apply" }).click();
    expect(lengths).toEqual([20]);
  });

  test("Unset reverts a set length to the detected end", async () => {
    const lengths: (number | undefined)[] = [];
    await renderDialog(true, { ...DETECTED, lengthQ: 20 }, lengths);
    const settings = dialog();
    const beats = settings.getByRole("spinbutton", { name: "Beats" });
    await expect.element(beats).toHaveTextContent("5.0.0");

    await settings.getByRole("button", { name: "Unset" }).click();
    await expect.element(beats).toHaveTextContent("2.0.0");
    await expect
      .element(settings.getByRole("button", { name: "Unset" }))
      .toBeDisabled();
    await settings.getByRole("button", { name: "Apply" }).click();
    expect(lengths).toEqual([undefined]);
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
