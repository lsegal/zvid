import { expect, type Page, test } from "@playwright/test";

// The preview draws at the device pixels its panel covers, not at the
// export size times the display's density, and follows the panel's size.
test.use({ deviceScaleFactor: 2 });

function previewHandle(page: Page) {
  return page.getByRole("separator", { name: "Resize preview panel" });
}

// The preview canvas's drawing buffer, and the one its panel calls for:
// the export size letterboxed into the panel at the device's density, but
// never larger than the export itself.
function canvasSizes(page: Page) {
  return page.locator(".composition-player__canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const [outputWidth, outputHeight] = canvas.style.aspectRatio
      .split("/")
      .map(Number);
    const ratio = Math.min(
      1,
      Math.min(
        canvas.clientWidth / outputWidth,
        canvas.clientHeight / outputHeight,
      ) * window.devicePixelRatio,
    );
    return {
      buffer: { width: canvas.width, height: canvas.height },
      expected: {
        width: Math.floor(outputWidth * ratio),
        height: Math.floor(outputHeight * ratio),
      },
      output: { width: outputWidth, height: outputHeight },
    };
  });
}

async function expectBufferToFitPanel(page: Page) {
  await expect
    .poll(async () => {
      const { buffer, expected } = await canvasSizes(page);
      return (
        Math.abs(buffer.width - expected.width) <= 1 &&
        Math.abs(buffer.height - expected.height) <= 1
      );
    })
    .toBe(true);
}

test("the preview buffer follows the panel size", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await expect(previewHandle(page)).toBeVisible();

  await expectBufferToFitPanel(page);
  const wide = await canvasSizes(page);
  expect(wide.buffer.width).toBeLessThan(wide.output.width * 2);

  // Narrowing the panel shrinks the buffer with it.
  await previewHandle(page).focus();
  await page.keyboard.press("Home");
  await expect
    .poll(async () => (await canvasSizes(page)).buffer.width)
    .toBeLessThan(wide.buffer.width);
  await expectBufferToFitPanel(page);
});
