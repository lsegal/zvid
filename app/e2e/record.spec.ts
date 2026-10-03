import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// The transport Record button (#855): recording armed source tracks from
// Chromium's fake camera and microphone into clips that grow from the
// playhead, then land in the session like imported media.
test.use({
  viewport: { width: 1600, height: 1000 },
  permissions: ["camera", "microphone"],
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  },
});

function recordButton(page: Page) {
  return page.locator(".transport-button--record");
}

function trackRow(page: Page) {
  return page.locator(".track-row--source[data-source-track-id]").first();
}

async function armFirstTrack(page: Page) {
  await trackRow(page)
    .getByRole("button", { name: /^Arm .* for recording$/ })
    .click();
}

async function liveClipWidth(page: Page) {
  const box = await page.locator(".live-recording-clip").boundingBox();
  return box?.width ?? 0;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-layer-header-id]").first()).toBeVisible();
  await page
    .locator(".track-row--source-drop")
    .getByRole("button", { name: "Track", exact: true })
    .click();
  await expect(trackRow(page)).toBeVisible();
});

test("Record is disabled until a source track is armed", async ({ page }) => {
  await expect(recordButton(page)).toBeDisabled();
  await armFirstTrack(page);
  await expect(trackRow(page)).toHaveClass(/track-row--armed/);
  await expect(recordButton(page)).toBeEnabled();
  await expect(recordButton(page)).toHaveAccessibleName("Record armed tracks");
});

test("Record plays from the playhead and grows a clip; Record again keeps playing", async ({
  page,
}) => {
  // Saving the take analyzes and caches it, which is slow under load.
  test.setTimeout(90_000);
  await armFirstTrack(page);
  await recordButton(page).click();

  await expect(recordButton(page)).toHaveClass(/transport-button--recording/);
  await expect(recordButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".app-shell")).toHaveClass(/app-shell--recording/);
  await expect(trackRow(page)).toHaveClass(/track-row--recording/);
  await expect(
    page.getByRole("button", { name: "Pause playback" }),
  ).toBeVisible();

  const clip = page.locator(".live-recording-clip");
  await expect(clip).toBeVisible();
  // The clip starts at the playhead, the start of the timeline.
  expect(await clip.evaluate((node) => (node as HTMLElement).style.left)).toBe(
    "0px",
  );
  await page.waitForTimeout(600);
  const early = await liveClipWidth(page);
  await page.waitForTimeout(1200);
  expect(await liveClipWidth(page)).toBeGreaterThan(early);
  await expect(
    clip.locator(".live-recording-clip__tile").first(),
  ).toHaveAttribute("style", /url\("data:image\/jpeg/);

  await recordButton(page).click();
  // Stopping the recording keeps playback going.
  await expect(recordButton(page)).not.toHaveClass(
    /transport-button--recording/,
  );
  await expect(
    page.getByRole("button", { name: "Pause playback" }),
  ).toBeVisible();
  await expect(page.locator(".app-shell")).not.toHaveClass(
    /app-shell--recording/,
  );

  // The take lands as a clip of new media at the playhead.
  const span = trackRow(page).locator(".source-span");
  await expect(span).toHaveCount(1, { timeout: 30_000 });
  await expect(clip).toHaveCount(0);
  expect(await span.evaluate((node) => (node as HTMLElement).style.left)).toBe(
    "0px",
  );
  await expect(page.locator(".status-bar")).toContainText("Recorded 1 clip.");
  await page.getByRole("button", { name: "Pause playback" }).click();
});

test("stopping playback ends the recording, and one undo removes the take", async ({
  page,
}) => {
  await armFirstTrack(page);
  await recordButton(page).click();
  await expect(page.locator(".live-recording-clip")).toBeVisible();
  await page.waitForTimeout(1500);

  await page.getByRole("button", { name: "Pause playback" }).click();
  await expect(recordButton(page)).not.toHaveClass(
    /transport-button--recording/,
  );
  const span = trackRow(page).locator(".source-span");
  await expect(span).toHaveCount(1, { timeout: 30_000 });

  await page.keyboard.press("ControlOrMeta+z");
  await expect(span).toHaveCount(0);
});

test("a recorded take plays in the arrangement and exports", async ({
  page,
}) => {
  test.setTimeout(180_000);
  // Without the save picker the web harness saves through a download. The
  // take records the camera only: Chromium builds without proprietary
  // codecs, like Playwright's on Linux, can't export audio to MP4.
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    localStorage.setItem("zvid-record-audio-input", "null");
  });
  await page.reload();
  await page
    .locator(".track-row--source-drop")
    .getByRole("button", { name: "Track", exact: true })
    .click();
  await armFirstTrack(page);
  await recordButton(page).click();
  await page.waitForTimeout(2500);
  await recordButton(page).click();
  await page.getByRole("button", { name: "Pause playback" }).click();
  const span = trackRow(page).locator(".source-span");
  await expect(span).toHaveCount(1, { timeout: 30_000 });

  // Ctrl/Cmd-click on a source clip drops it on the arrangement.
  await span.click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await expect(page.locator(".preview-placeholder")).toHaveCount(0, {
    timeout: 30_000,
  });

  const download = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Width").fill("320");
  await dialog.getByLabel("Height").fill("180");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const path = await (await download).path();
  const bytes = [...(await readFile(path))];

  // Chromium's fake camera is mostly green, so the export shows it.
  const frame = await page.evaluate(async (data) => {
    const video = document.createElement("video");
    video.muted = true;
    video.src = URL.createObjectURL(
      new Blob([new Uint8Array(data)], { type: "video/mp4" }),
    );
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = reject;
    });
    video.currentTime = Math.min(1, video.duration / 2);
    await new Promise((resolve) => {
      video.onseeked = resolve;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2D context");
    context.drawImage(video, 0, 0, 16, 16);
    const { data: pixels } = context.getImageData(0, 0, 16, 16);
    let red = 0;
    let green = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      red += pixels[index];
      green += pixels[index + 1];
    }
    return { duration: video.duration, red, green };
  }, bytes);
  expect(frame.duration).toBeGreaterThan(1.5);
  expect(frame.green).toBeGreaterThan(frame.red * 1.5);
});

test("a recorded take is saved with the session and reloads", async ({
  page,
}) => {
  await armFirstTrack(page);
  await recordButton(page).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Pause playback" }).click();
  const span = trackRow(page).locator(".source-span");
  await expect(span).toHaveCount(1, { timeout: 30_000 });
  // Takes are named after their track.
  await expect(span).toContainText("Source Track 1");

  // Once autosaved, a reload restores the take with its media online.
  await expect
    .poll(
      async () => (await readSavedPayload(page))?.includes("Source Track"),
      {
        timeout: 10_000,
      },
    )
    .toBe(true);
  await expect
    .poll(async () => (await readSavedPayload(page))?.includes(".webm"), {
      timeout: 10_000,
    })
    .toBe(true);
  await page.reload();
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
  await expect(page.locator(".source-span")).toContainText("Source Track 1");
  await expect(page.locator(".source-span")).toContainText(/online/i, {
    timeout: 30_000,
  });
});

// Saving must never drop a take that captured something (#881).
test("a take whose analysis fails stays on its track", async ({ page }) => {
  await page.evaluate(() => {
    const harness = (window as unknown as { harness: Record<string, unknown> })
      .harness;
    harness.analyzeMedia = async () => {
      throw new Error("analysis failed");
    };
  });
  await armFirstTrack(page);
  await recordButton(page).click();
  await expect(page.locator(".live-recording-clip")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Pause playback" }).click();

  const span = trackRow(page).locator(".source-span");
  await expect(span).toHaveCount(1, { timeout: 30_000 });
  await expect(span).toContainText("Source Track 1");
  await expect(page.locator(".status-bar")).toContainText(
    "Recorded 1 clip. 1 clip couldn't be analyzed",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a take that can't be kept shows an error naming its track", async ({
  page,
}) => {
  // Neither analyzing the take nor reading it as recorded works.
  await page.evaluate(() => {
    const harness = (window as unknown as { harness: Record<string, unknown> })
      .harness;
    harness.analyzeMedia = async () => {
      throw new Error("analysis failed");
    };
    const createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof File && object.name.startsWith("Source Track")) {
        throw new Error("the browser is out of memory");
      }
      return createObjectURL(object);
    };
  });
  await armFirstTrack(page);
  await recordButton(page).click();
  await expect(page.locator(".live-recording-clip")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Pause playback" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Couldn't keep 1 recording", {
    timeout: 30_000,
  });
  await expect(alert).toContainText(
    "Source Track 1: the browser is out of memory.",
  );
  await expect(page.locator(".live-recording-clip")).toHaveCount(0);
  await expect(trackRow(page).locator(".source-span")).toHaveCount(0);
  await alert.getByRole("button", { name: "Dismiss" }).click();
  await expect(alert).toHaveCount(0);
});

// The saved session payload, or null when nothing is saved.
function readSavedPayload(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string | null>((resolve, reject) => {
        const request = indexedDB.open("zvid-workspace");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("sessions")) {
            database.close();
            resolve(null);
            return;
          }
          const get = database
            .transaction("sessions", "readonly")
            .objectStore("sessions")
            .get("current");
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            database.close();
            resolve(
              (get.result as { payload?: string } | undefined)?.payload ?? null,
            );
          };
        };
      }),
  );
}
