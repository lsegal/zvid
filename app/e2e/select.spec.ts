import { expect, type Page, test } from "@playwright/test";

// Every dropdown is the shared themed Select (components/ui/select.tsx), not
// a native <select>, whose list Chromium on Windows paints light gray.

function dialog(page: Page) {
  return page.getByRole("dialog", { name: "Session Settings" });
}

async function openSettings(page: Page) {
  await page.goto("/");
  await expect(
    page.locator(".status-bar__item--button", { hasText: "Res" }),
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+,");
  await expect(dialog(page)).toBeVisible();
  return dialog(page);
}

// The open list is the app's dark menu panel, not a light native popup.
async function expectThemedList(page: Page) {
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();
  await expect(list).toHaveClass(/select-content/);
  const background = await list.evaluate(
    (element) => getComputedStyle(element).backgroundImage,
  );
  expect(background).toContain("rgb(26, 29, 40)");
  return list;
}

test("Session Settings dropdowns open a themed list and pick a value", async ({
  page,
}) => {
  const settings = await openSettings(page);

  const preset = settings.getByRole("combobox", { name: "Canvas preset" });
  await expect(preset).toHaveText("1080p 16:9");
  await preset.click();
  const list = await expectThemedList(page);
  await expect(list.getByRole("option")).toHaveText([
    "1080p 16:9",
    "1080×1920 9:16",
    "1080×1080 1:1",
    "4K 16:9",
    "720p 16:9",
    "Custom",
  ]);
  await expect(
    list.getByRole("option", { name: "1080p 16:9" }),
  ).toHaveAttribute("aria-selected", "true");
  await list.getByRole("option", { name: "4K 16:9" }).click();
  await expect(list).toBeHidden();
  await expect(preset).toHaveText("4K 16:9");
  await expect(settings.getByLabel("Canvas width")).toHaveValue("3840");
  await expect(settings.getByLabel("Canvas height")).toHaveValue("2160");
});

test("a dropdown is keyboard navigable", async ({ page }) => {
  const settings = await openSettings(page);
  const rate = settings.getByRole("combobox", { name: "Audio sample rate" });
  const before = await rate.textContent();

  await rate.focus();
  await page.keyboard.press("Enter");
  const list = await expectThemedList(page);
  const options = await list.getByRole("option").allTextContents();
  // Step to a neighbor: down, or up from the last option.
  const index = options.indexOf(before ?? "");
  expect(index).toBeGreaterThanOrEqual(0);
  const down = index < options.length - 1;
  const next = options[down ? index + 1 : index - 1];
  // The list opens with the current value focused.
  await expect(list.getByRole("option", { name: before ?? "" })).toBeFocused();
  await page.keyboard.press(down ? "ArrowDown" : "ArrowUp");
  await expect(list.getByRole("option", { name: next })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(list).toBeHidden();
  await expect(rate).toHaveText(next);
  await expect(rate).toBeFocused();

  // Escape closes the list without changing the value.
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option", { name: next })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(rate).toHaveText(next);
  await expect(settings).toBeVisible();
});

test("an unsupported codec shows dimmed and can't be picked", async ({
  page,
}) => {
  // Report no HEVC encoder, whatever the machine has.
  await page.addInitScript(() => {
    const isConfigSupported = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    VideoEncoder.isConfigSupported = async (config) =>
      /^(hev|hvc)1/.test(config.codec)
        ? { supported: false, config }
        : isConfigSupported(config);
  });
  const settings = await openSettings(page);
  const codec = settings.getByRole("combobox", { name: "Video codec" });
  await expect(codec).toHaveText("Auto (best available)");

  await codec.click();
  const list = await expectThemedList(page);
  const hevc = list.getByRole("option", { name: /^HEVC/ });
  await expect(hevc).toHaveText("HEVC (Not supported on this device)");
  await expect(hevc).toHaveAttribute("aria-disabled", "true");
  await expect(hevc).toHaveAttribute("title", "Not supported on this device");
  await hevc.click({ force: true });
  await expect(list).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(codec).toHaveText("Auto (best available)");
});

test("the time signature is a themed dropdown", async ({ page }) => {
  await page.goto("/");
  const signature = page.getByRole("combobox", { name: "Time signature" });
  await expect(signature).toHaveText("4/4");
  await signature.click();
  const list = await expectThemedList(page);
  await list.getByRole("option", { name: "6/8" }).click();
  await expect(signature).toHaveText("6/8");

  await page.keyboard.press("ControlOrMeta+z");
  await expect(signature).toHaveText("4/4");
});

test("FX Animation motion dropdowns are themed and commit a value", async ({
  page,
}) => {
  await page.goto("/");
  // Order has no Motion In or Out, so add a device that does.
  const layerHeader = page.locator('[data-layer-header-id="6"]');
  await expect(layerHeader).toBeVisible();
  await layerHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add FX", exact: true }).hover();
  await page
    .getByRole("menu", { name: "Add FX" })
    .getByRole("menuitem", { name: /^Pixelate/ })
    .click();
  const section = page.locator('section[aria-label="Pixelate animation"]');
  await expect(section).toBeVisible();

  const motionIn = section.getByRole("combobox", { name: "Motion In" });
  await expect(motionIn).toHaveText("Ease Out");
  await motionIn.click();
  const list = await expectThemedList(page);
  const options = await list.getByRole("option").allTextContents();
  const other = options.find((option) => option !== "Ease Out");
  expect(other).toBeTruthy();
  await list.getByRole("option", { name: other, exact: true }).click();
  await expect(motionIn).toHaveText(other ?? "");
});
