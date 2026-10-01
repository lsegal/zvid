import { expect, type Page, test } from "@playwright/test";

// The transport bar centers its transport buttons, with the zoom control on
// the left and the preview volume on the right. The volume is a per-viewer
// preference that plays the main audio quieter without touching what
// audio-reactive effects measure.

function bar(page: Page) {
  return page.locator(".transport-bar");
}

function volumeSlider(page: Page) {
  return page.getByRole("slider", { name: "Preview volume" });
}

async function box(page: Page, selector: string) {
  const rect = await page.locator(selector).boundingBox();
  if (!rect) {
    throw new Error(`${selector} is not visible`);
  }
  return rect;
}

async function openEditor(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.locator('[data-timeline-lane-id="1"]')).toBeVisible();
}

test("the transport buttons sit in the middle of the bar, volume on the right", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);

  const barBox = await box(page, ".transport-bar");
  const cluster = await box(page, ".transport-cluster");
  const zoom = await box(page, ".zoom-control");
  const volume = await box(page, ".volume-control");
  const barCenter = barBox.x + barBox.width / 2;
  expect(Math.abs(cluster.x + cluster.width / 2 - barCenter)).toBeLessThan(3);
  expect(zoom.x).toBeLessThan(cluster.x);
  expect(volume.x).toBeGreaterThan(cluster.x + cluster.width);
  // Right-aligned against the bar's padding.
  expect(barBox.x + barBox.width - (volume.x + volume.width)).toBeLessThan(24);
});

test("the transport bar doesn't overflow a phone-width screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await openEditor(page);

  await expect(volumeSlider(page)).toBeVisible();
  const overflow = await bar(page).evaluate((element) => ({
    bar: element.scrollWidth - element.clientWidth,
    page: document.documentElement.scrollWidth - window.innerWidth,
  }));
  expect(overflow).toEqual({ bar: 0, page: 0 });
  const volume = await box(page, ".volume-control");
  expect(volume.x + volume.width).toBeLessThanOrEqual(375);
});

test("mute keeps the slider position and the volume survives a reload", async ({
  page,
}) => {
  await openEditor(page);
  const slider = volumeSlider(page);
  await expect(slider).toHaveValue("1");

  await slider.fill("0.4");
  await expect(slider).toHaveAttribute("aria-valuetext", "40%");
  await page.getByRole("button", { name: "Mute preview" }).click();
  await expect(slider).toHaveValue("0.4");
  await expect(slider).toHaveAttribute("aria-valuetext", "40%, muted");

  await page.reload();
  await expect(volumeSlider(page)).toHaveValue("0.4");
  await page.getByRole("button", { name: "Unmute preview" }).click();
  await expect(
    page.getByRole("button", { name: "Mute preview" }),
  ).toBeVisible();

  // Dragging the slider above zero while muted unmutes.
  await page.getByRole("button", { name: "Mute preview" }).click();
  await volumeSlider(page).fill("0.6");
  await expect(
    page.getByRole("button", { name: "Mute preview" }),
  ).toBeVisible();
});

test.describe("with main audio", () => {
  // The sample reads about 15 MB of media and analyzes it.
  test.describe.configure({ timeout: 120_000 });

  test("the slider sets how loud the main audio plays", async ({ page }) => {
    // Records the media elements and Web Audio gains the preview makes, since
    // the main audio element is never added to the page.
    await page.addInitScript(() => {
      const probe = window as unknown as {
        mediaElements: HTMLMediaElement[];
        gains: GainNode[];
      };
      probe.mediaElements = [];
      probe.gains = [];
      const createElement = Document.prototype.createElement;
      Document.prototype.createElement = function (
        this: Document,
        tagName: string,
        options?: ElementCreationOptions,
      ) {
        const element = createElement.call(this, tagName, options);
        if (element instanceof HTMLAudioElement) {
          probe.mediaElements.push(element);
        }
        return element;
      } as typeof Document.prototype.createElement;
      const createGain = AudioContext.prototype.createGain;
      AudioContext.prototype.createGain = function (this: AudioContext) {
        const gain = createGain.call(this);
        probe.gains.push(gain);
        return gain;
      };
    });
    await page.goto("/?sample=1");
    await expect(page.getByText("Media linked")).toBeVisible({
      timeout: 60_000,
    });

    // The main audio plays at `level`, either on the element itself or,
    // when audio-reactive effects route it through Web Audio, on the gain
    // after the analyser while the element stays at full volume.
    const mainAudioLevel = () =>
      page.evaluate(() => {
        const probe = window as unknown as {
          mediaElements: HTMLMediaElement[];
          gains: GainNode[];
        };
        const main = probe.mediaElements.find((element) =>
          element.getAttribute("src"),
        );
        if (!main) {
          return null;
        }
        const gain = probe.gains.at(-1);
        if (gain && main.volume === 1 && !main.muted) {
          return Math.round(gain.gain.value * 100) / 100;
        }
        return main.muted ? 0 : Math.round(main.volume * 100) / 100;
      });

    await expect.poll(mainAudioLevel).toBe(1);
    await volumeSlider(page).fill("0.3");
    await expect.poll(mainAudioLevel).toBe(0.3);
    await page.getByRole("button", { name: "Mute preview" }).click();
    await expect.poll(mainAudioLevel).toBe(0);
    await page.getByRole("button", { name: "Unmute preview" }).click();
    await expect.poll(mainAudioLevel).toBe(0.3);
  });
});
