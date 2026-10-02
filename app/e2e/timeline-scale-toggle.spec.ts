import { expect, test } from "@playwright/test";

// The timeline toolbar's scale toggle: Tempo shows bar numbers on the ruler,
// Time shows timecode.

test("the scale toggle reads Tempo / Time and switches the ruler", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('[data-timeline-lane-id="1"]')).toBeVisible();

  const tempo = page.getByRole("button", { name: "Tempo", exact: true });
  const time = page.getByRole("button", { name: "Time", exact: true });
  const firstLabel = page.locator(".ruler-marker span").first();
  await expect(tempo).toBeVisible();
  await expect(time).toBeVisible();
  await expect(time).toHaveCSS("text-transform", "uppercase");
  await expect(page.getByRole("button", { name: "SMPTE" })).toHaveCount(0);

  await expect(tempo).toHaveClass(/is-active/);
  await expect(firstLabel).toHaveText("1");

  await time.click();
  await expect(time).toHaveClass(/is-active/);
  await expect(tempo).not.toHaveClass(/is-active/);
  await expect(firstLabel).toHaveText("00:00:00");

  await tempo.click();
  await expect(tempo).toHaveClass(/is-active/);
  await expect(firstLabel).toHaveText("1");
});
