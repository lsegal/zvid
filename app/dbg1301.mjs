import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto("http://localhost:1531/?sample=1");
await page.waitForTimeout(9000);
const snap = page.getByRole("button", { name: /snap/i });
console.log("snap buttons", await snap.count(), await snap.first().innerText());
await snap.first().click();
await page.waitForTimeout(300);
console.log("after", await snap.first().innerText());
const rb = await page.locator(".ruler-row").first().boundingBox();
for (const t of [11.8, 12.1, 12.3]) {
  await page.mouse.click(243 + t * 37.333, rb.y + rb.height / 2);
  await page.waitForTimeout(300);
  console.log(t, await page.getByText(/^Pos/).first().innerText().catch(() => "?"), await page.locator("body").innerText().then(s => (s.match(/Pos\s+\S+/)||[])[0]));
}
await browser.close();
