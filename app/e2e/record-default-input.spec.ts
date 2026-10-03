import { expect, type Page, test } from "@playwright/test";

// The default audio input (#875): left on System default, the preview and
// the recording open the device the default names, by its ID, the same way
// as picking that device, rather than leaving the choice to getUserMedia.
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

type AudioRequest = string | boolean | undefined;

// Logs the audio device each getUserMedia call asks for: its exact ID, or
// true when the browser chooses.
async function logAudioRequests(page: Page) {
  await page.addInitScript(() => {
    const devices = navigator.mediaDevices;
    const getUserMedia = devices.getUserMedia.bind(devices);
    const log: AudioRequest[] = [];
    (window as unknown as { audioRequests: AudioRequest[] }).audioRequests =
      log;
    devices.getUserMedia = (constraints) => {
      const audio = constraints?.audio;
      log.push(
        typeof audio === "object"
          ? (audio.deviceId as { exact: string } | undefined)?.exact
          : audio,
      );
      return getUserMedia(constraints);
    };
  });
}

function audioRequests(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { audioRequests: AudioRequest[] }).audioRequests,
  );
}

// Chromium's fake devices list a "default" alias that names no device, so
// the default is the first microphone listed.
function firstMicrophone(page: Page) {
  return page.evaluate(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.find(
      (device) =>
        device.kind === "audioinput" &&
        device.deviceId &&
        device.deviceId !== "default" &&
        device.deviceId !== "communications",
    )?.deviceId;
  });
}

function drawer(page: Page) {
  return page.getByRole("complementary", { name: "Media" });
}

// The toolbar's Record switch, which opens the drawer on its Record tab.
function recordSegment(page: Page) {
  return page
    .getByRole("group", { name: "Media drawer" })
    .getByRole("button", { name: "Record", exact: true });
}

test("System default previews and records the device it names", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await logAudioRequests(page);
  await page.goto("/");
  await expect(page.locator("[data-layer-header-id]").first()).toBeVisible();

  await recordSegment(page).click();
  await expect(
    drawer(page).getByRole("combobox", { name: "Audio input" }),
  ).toHaveText(/^System default/);

  // Once the browser lists device IDs, the preview reopens on the device.
  await expect.poll(() => firstMicrophone(page)).toBeTruthy();
  const microphone = await firstMicrophone(page);
  await expect
    .poll(async () => (await audioRequests(page)).at(-1))
    .toBe(microphone);
  const meter = drawer(page).locator(".record-input-picker__audio");
  await expect
    .poll(async () =>
      Number(
        await meter
          .getByRole("meter", { name: "Left level" })
          .getAttribute("aria-valuenow"),
      ),
    )
    .toBeGreaterThan(-60);
  await recordSegment(page).click();
  await expect(drawer(page)).toBeHidden();

  // A track left on its "Default (…)" input records from the same device.
  await page
    .locator(".track-row--source-drop")
    .getByRole("button", { name: "Track", exact: true })
    .click();
  const track = page.locator(".track-row--source[data-source-track-id]");
  await track
    .first()
    .getByRole("button", { name: /^Arm .* for recording$/ })
    .click();
  const before = (await audioRequests(page)).length;
  const record = page.locator(".transport-button--record");
  await record.click();
  await expect(page.locator(".live-recording-clip")).toBeVisible();
  const recording = (await audioRequests(page)).slice(before);
  expect(recording.length).toBeGreaterThan(0);
  expect(recording.every((request) => request === microphone)).toBe(true);

  await page.waitForTimeout(1000);
  await record.click();
  await expect(track.first().locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Pause playback" }).click();
});
