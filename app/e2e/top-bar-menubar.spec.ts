import { expect, type Page, test } from "@playwright/test";

// File, Edit and Help sit together in the top bar as a desktop-style menubar:
// compact borderless items with chevrons, Left/Right roving focus, and
// switching menus by hovering or arrowing while one is open.

function menubar(page: Page) {
  return page.getByRole("menubar");
}

function trigger(page: Page, name: string) {
  return menubar(page).getByRole("menuitem", { name, exact: true });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(menubar(page)).toBeVisible();
});

test("File, Edit and Help are adjacent compact items with chevrons", async ({
  page,
}) => {
  const items = menubar(page).getByRole("menuitem");
  await expect(items).toHaveText(["File", "Edit", "Help"]);
  await expect(menubar(page).locator(".menubar-item__chevron")).toHaveCount(3);

  const boxes = await Promise.all(
    ["File", "Edit", "Help"].map(
      async (name) => (await trigger(page, name).boundingBox()) ?? undefined,
    ),
  );
  for (const [index, box] of boxes.entries()) {
    if (index === 0) continue;
    const previous = boxes[index - 1];
    if (!box || !previous) throw new Error("menubar item has no box");
    expect(Math.abs(box.y - previous.y)).toBeLessThan(1);
    const gap = box.x - (previous.x + previous.width);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(4);
  }

  // Help is no longer in the right-hand group.
  await expect(
    page.locator(".topbar__group--right").getByText("Help", { exact: true }),
  ).toHaveCount(0);
});

test("items have no border or background at rest and highlight while open", async ({
  page,
}) => {
  const file = trigger(page, "File");
  const styles = () =>
    file.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        border: style.borderTopWidth,
      };
    });
  await page.mouse.move(0, 0);
  expect(await styles()).toEqual({
    background: "rgba(0, 0, 0, 0)",
    border: "0px",
  });

  await file.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(file).toHaveAttribute("data-state", "open");
  await page.mouse.move(0, 0);
  expect((await styles()).background).not.toBe("rgba(0, 0, 0, 0)");
});

test("arrow keys move between the triggers and open menus", async ({
  page,
}) => {
  const file = trigger(page, "File");
  const edit = trigger(page, "Edit");
  const help = trigger(page, "Help");
  await file.focus();
  await expect(file).toHaveAttribute("tabindex", "0");

  await page.keyboard.press("ArrowRight");
  await expect(edit).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(help).toBeFocused();
  await expect(help).toHaveAttribute("tabindex", "0");
  await expect(file).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("ArrowRight");
  await expect(file).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(help).toBeFocused();

  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Getting Started" }),
  ).toBeFocused();

  // Right from the last menu wraps around to File's menu.
  await page.keyboard.press("ArrowRight");
  await expect(file).toHaveAttribute("data-state", "open");
  await expect(help).toHaveAttribute("data-state", "closed");
  await expect(
    page.getByRole("menu").getByRole("menuitem", { name: "Open Session" }),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(file).toBeFocused();
});

test("hovering a neighbor while a menu is open switches menus", async ({
  page,
}) => {
  await trigger(page, "File").click();
  await expect(
    page.getByRole("menu").getByRole("menuitem", { name: "Open Session" }),
  ).toBeVisible();

  await trigger(page, "Help").hover();
  await expect(trigger(page, "Help")).toHaveAttribute("data-state", "open");
  await expect(trigger(page, "File")).toHaveAttribute("data-state", "closed");
  await expect(page.getByRole("menu")).toHaveCount(1);
  await expect(
    page.getByRole("menu").getByRole("menuitem", { name: "Getting Started" }),
  ).toBeVisible();
});

test("Help's menu opens under its trigger and its items still work", async ({
  page,
}) => {
  const help = trigger(page, "Help");
  await help.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const helpBox = await help.boundingBox();
  const menuBox = await menu.boundingBox();
  if (!helpBox || !menuBox) throw new Error("Help menu has no box");
  expect(Math.abs(menuBox.x - helpBox.x)).toBeLessThan(2);

  await menu.getByRole("menuitem", { name: "Download Desktop App" }).click();
  await expect(
    page.getByRole("dialog", { name: "Download the zvid desktop app" }),
  ).toBeVisible();
});

test("submenus keep their own Left/Right keys", async ({ page }) => {
  const edit = trigger(page, "Edit");
  await edit.click();
  const audio = page.getByRole("menuitem", { name: /^Audio/ });
  await audio.hover();
  await expect(audio).toBeFocused();

  // Right on a submenu trigger opens its submenu rather than Help.
  await page.keyboard.press("ArrowRight");
  const submenu = page.getByRole("menu").nth(1);
  await expect(submenu).toBeVisible();
  await expect(submenu.getByRole("menuitem").first()).toBeFocused();
  await expect(edit).toHaveAttribute("data-state", "open");
  await expect(trigger(page, "Help")).toHaveAttribute("data-state", "closed");

  // Left inside the submenu closes it rather than switching to File.
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("menu")).toHaveCount(1);
  await expect(audio).toBeFocused();
  await expect(edit).toHaveAttribute("data-state", "open");
  await expect(trigger(page, "File")).toHaveAttribute("data-state", "closed");
});
