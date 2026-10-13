import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 4 });
await page.goto("http://localhost:1531/?sample=1");
await page.waitForTimeout(9000);
await page.getByRole("button", { name: /snap/i }).first().click();
await page.waitForTimeout(300);
const canvas = page.locator(".composition-player__canvas");
const ruler = page.locator(".ruler-row").first();
const rb = await ruler.boundingBox();
const x0 = 243, pps = 37.333;
async function at(t, file) {
  await page.mouse.click(x0 + t * pps, rb.y + rb.height / 2);
  await page.waitForTimeout(350);
  await canvas.screenshot({ path: file });
  if (file.endsWith("000.png")) console.log(t, await page.locator("footer, .status-bar").first().innerText().catch(()=>"?"));
}
const ranges = [["a", 11.8, 13.2], ["b", 20.8, 24.2]];
for (const [name, from, to] of ranges) {
  let i = 0;
  for (let t = from; t <= to + 1e-6; t += 1 / 15) {
    await at(t, `/tmp/cap1301/${name}-${String(i++).padStart(3, "0")}.png`);
  }
}
const pos = await page.locator("text=/Pos \\d/").first().textContent().catch(() => "");
console.log(pos);
await browser.close();
