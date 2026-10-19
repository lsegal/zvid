import { useState } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { type Locator, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  createEffect,
  mapSessionEffectsToDevices,
  setEffectAnimation,
} from "../../fx-stack.ts";
import { DEFAULT_SESSION_SETTINGS } from "../../session-settings.ts";
import { FxAnimationPanel } from "../fx/FxAnimationPanel";
import { SessionSettingsDialog } from "../SessionSettingsDialog";
import "./select";

// Every dropdown is the shared themed Select (components/ui/select.tsx), not
// a native <select>, whose list Chromium on Windows paints light gray.

const noop = () => {};

// Waits for `locator`'s text to be exactly `text`, as Playwright's
// toHaveText does.
async function expectText(locator: Locator, text: string) {
  await expect
    .poll(() => locator.element().textContent?.replace(/\s+/g, " ").trim())
    .toBe(text);
}

// The open list is the app's dark menu panel, not a light native popup.
async function expectThemedList() {
  const list = page.getByRole("listbox");
  await expect.element(list).toBeVisible();
  await expect.element(list).toHaveClass(/select-content/);
  const background = getComputedStyle(list.element()).backgroundImage;
  expect(background).toContain("rgb(26, 29, 40)");
  return list;
}

function optionTexts(list: Locator) {
  return list
    .getByRole("option")
    .elements()
    .map((option) => option.textContent ?? "");
}

// File ▸ Session Settings, opened with its Ctrl/Cmd+, shortcut.
function SessionSettings() {
  const [open, setOpen] = useState(false);
  return (
    <SessionSettingsDialog
      onApply={noop}
      onOpenChange={setOpen}
      open={open}
      length={{
        bpm: 120,
        signature: { numerator: 4, denominator: 4 },
        detectedQ: 4,
      }}
      settings={DEFAULT_SESSION_SETTINGS}
    />
  );
}

async function openSettings() {
  await render(<SessionSettings />);
  await userEvent.keyboard("{Control>},{/Control}");
  const dialog = page.getByRole("dialog", { name: "Session Settings" });
  await expect.element(dialog).toBeVisible();
  return dialog;
}

describe("Select in Session Settings", () => {
  const isConfigSupported = VideoEncoder.isConfigSupported;
  afterEach(() => {
    VideoEncoder.isConfigSupported = isConfigSupported;
  });

  test("opens a themed list and picks a value", async () => {
    const settings = await openSettings();

    const preset = settings.getByRole("combobox", { name: "Canvas preset" });
    await expectText(preset, "1080p 16:9");
    await preset.click();
    const list = await expectThemedList();
    expect(optionTexts(list)).toEqual([
      "1080p 16:9",
      "1080×1920 9:16",
      "1080×1080 1:1",
      "4K 16:9",
      "720p 16:9",
      "Custom",
    ]);
    await expect
      .element(list.getByRole("option", { name: "1080p 16:9" }))
      .toHaveAttribute("aria-selected", "true");
    await list.getByRole("option", { name: "4K 16:9" }).click();
    await expect.element(list).not.toBeInTheDocument();
    await expectText(preset, "4K 16:9");
    await expect
      .element(settings.getByLabelText("Canvas width"))
      .toHaveValue(3840);
    await expect
      .element(settings.getByLabelText("Canvas height"))
      .toHaveValue(2160);
  });

  test("is keyboard navigable", async () => {
    const settings = await openSettings();
    const rate = settings.getByRole("combobox", { name: "Audio sample rate" });
    const before = rate.element().textContent ?? "";

    (rate.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    const list = await expectThemedList();
    const options = optionTexts(list);
    // Step to a neighbor: down, or up from the last option.
    const index = options.indexOf(before);
    expect(index).toBeGreaterThanOrEqual(0);
    const down = index < options.length - 1;
    const next = options[down ? index + 1 : index - 1];
    // The list opens with the current value focused.
    await expect
      .element(list.getByRole("option", { name: before, exact: true }))
      .toHaveFocus();
    await userEvent.keyboard(down ? "{ArrowDown}" : "{ArrowUp}");
    await expect
      .element(list.getByRole("option", { name: next, exact: true }))
      .toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(list).not.toBeInTheDocument();
    await expectText(rate, next);
    await expect.element(rate).toHaveFocus();

    // Escape closes the list without changing the value.
    await userEvent.keyboard("{Enter}");
    await expect
      .element(page.getByRole("option", { name: next, exact: true }))
      .toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("listbox")).not.toBeInTheDocument();
    await expectText(rate, next);
    await expect.element(settings).toBeVisible();
  });

  test("shows an unsupported codec dimmed and doesn't pick it", async () => {
    // Report no HEVC encoder, whatever the machine has.
    VideoEncoder.isConfigSupported = async (config) =>
      /^(hev|hvc)1/.test(config.codec)
        ? { supported: false, config }
        : isConfigSupported.call(VideoEncoder, config);
    const settings = await openSettings();
    const codec = settings.getByRole("combobox", { name: "Video codec" });
    await expectText(codec, "Auto (best available)");

    await codec.click();
    const list = await expectThemedList();
    const hevc = list.getByRole("option", { name: /^HEVC/ });
    await expectText(hevc, "HEVC (Not supported on this device)");
    await expect.element(hevc).toHaveAttribute("aria-disabled", "true");
    await expect
      .element(hevc)
      .toHaveAttribute("title", "Not supported on this device");
    await hevc.click({ force: true });
    await expect.element(list).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expectText(codec, "Auto (best available)");
  });
});

// A Pixelate device on Layer 1 with its Animation section, which commits
// to the session's effects. Order has no Motion In or Out, so Pixelate.
function PixelateAnimation() {
  const [effects, setEffects] = useState(() => [
    createEffect("1", "Pixelate", "pixelate"),
  ]);
  const device = mapSessionEffectsToDevices(effects, "1").find(
    (candidate) => candidate.effectName === "Pixelate",
  );
  if (!device?.animation) {
    return null;
  }
  return (
    <FxAnimationPanel
      animation={device.animation}
      bypassed={false}
      collapsed={false}
      device={device}
      onSetAnimation={(target, animation) =>
        setEffects((current) =>
          setEffectAnimation(current, target.id, animation),
        )
      }
      onToggleCollapsed={noop}
    />
  );
}

describe("Select in the FX Animation section", () => {
  test("themes the motion dropdowns, which commit a value", async () => {
    await render(<PixelateAnimation />);
    const section = page.getByRole("region", { name: "Pixelate animation" });
    await expect.element(section).toBeVisible();

    const motionIn = section.getByRole("combobox", { name: "Motion In" });
    await expectText(motionIn, "Ease Out");
    await motionIn.click();
    const list = await expectThemedList();
    const other = optionTexts(list).find((option) => option !== "Ease Out");
    expect(other).toBeTruthy();
    await list.getByRole("option", { name: other, exact: true }).click();
    await expectText(motionIn, other ?? "");
  });
});
