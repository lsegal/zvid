import { expect, type Page, test } from "@playwright/test";

// UI text can't be selected; only text fields can (#865).
function selectedText(page: Page) {
  return page.evaluate(() => window.getSelection()?.toString() ?? "");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-timeline-lane-id="1"]')).toBeVisible();
});

test("double-clicking or dragging across UI text selects nothing", async ({
  page,
}) => {
  // A layer's number, since double-clicking its name renames it (#940).
  const label = page.locator('[data-layer-header-id="1"] .track-label__index');
  await expect(label).toHaveText("1");
  await label.dblclick();
  expect(await selectedText(page)).toBe("");

  const box = await page.locator(".app-shell").boundingBox();
  if (!box) throw new Error("app shell has no box");
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  expect(await selectedText(page)).toBe("");
});

test("select all outside a text field highlights no page text", async ({
  page,
}) => {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    const range = document.createRange();
    range.selectNodeContents(document.body);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  expect(await selectedText(page)).toBe("");
});

test("text fields stay selectable and other inputs don't", async ({ page }) => {
  const styles = await page.evaluate(() => {
    const host = document.createElement("div");
    host.className = "fader";
    const make = (html: string) => {
      host.insertAdjacentHTML("beforeend", html);
      return host.lastElementChild as HTMLElement;
    };
    const fields = {
      text: make('<input type="text" value="hello">'),
      number: make('<input type="number" value="12">'),
      untyped: make('<input value="name">'),
      textarea: make("<textarea>words</textarea>"),
      checkbox: make('<input type="checkbox">'),
      range: make('<input type="range">'),
      color: make('<input type="color">'),
    };
    document.body.append(host);
    const result = Object.fromEntries(
      Object.entries(fields).map(([name, field]) => [
        name,
        getComputedStyle(field).userSelect,
      ]),
    );
    result.body = getComputedStyle(document.body).userSelect;
    host.remove();
    return result;
  });
  expect(styles).toEqual({
    text: "text",
    number: "text",
    untyped: "text",
    textarea: "text",
    checkbox: "none",
    range: "none",
    color: "none",
    body: "none",
  });

  await page.evaluate(() => {
    const field = document.createElement("textarea");
    field.id = "selection-probe";
    field.value = "copy me";
    document.body.append(field);
  });
  const field = page.locator("#selection-probe");
  await field.focus();
  await field.press("ControlOrMeta+a");
  expect(
    await field.evaluate((el: HTMLTextAreaElement) =>
      el.value.slice(el.selectionStart, el.selectionEnd),
    ),
  ).toBe("copy me");
});
