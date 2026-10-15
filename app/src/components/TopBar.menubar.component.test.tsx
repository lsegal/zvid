import { afterEach, describe, expect, test } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { Harness } from "../harness";
import { setTheme, THEME_STORAGE_KEY } from "../theme.ts";
import { TopBarHarness } from "./top-bar-test-harness.tsx";
import "./TopBar";

// File, Edit and Help sit together in the top bar as a desktop-style
// menubar: compact borderless items with chevrons, Left/Right roving focus,
// and switching menus by hovering or arrowing while one is open.

function menubar() {
  return page.getByRole("menubar");
}

function trigger(name: string) {
  return menubar().getByRole("menuitem", { name, exact: true });
}

// Moves the mouse to the window's top-left corner, off every menubar item.
// Raw input, unlike userEvent.unhover, doesn't wait on the page's frames,
// which other test files' iframes slow down.
async function moveMouseToCorner() {
  await cdp().send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 0,
    y: 0,
  });
}

async function renderTopBar() {
  const screen = await render(<TopBarHarness />);
  await expect.element(menubar()).toBeVisible();
  return screen;
}

describe("TopBar menubar", () => {
  afterEach(() => {
    setTheme("dark");
    localStorage.removeItem(THEME_STORAGE_KEY);
  });

  test("has File, Edit and Help as adjacent compact items with chevrons", async () => {
    await renderTopBar();
    const items = menubar().getByRole("menuitem").elements();
    expect(items.map((item) => item.textContent)).toEqual([
      "File",
      "Edit",
      "Help",
    ]);
    expect(
      menubar().element().querySelectorAll(".menubar-item__chevron"),
    ).toHaveLength(3);

    const boxes = ["File", "Edit", "Help"].map((name) =>
      trigger(name).element().getBoundingClientRect(),
    );
    for (const [index, box] of boxes.entries()) {
      if (index === 0) continue;
      const previous = boxes[index - 1];
      expect(Math.abs(box.y - previous.y)).toBeLessThan(1);
      const gap = box.x - (previous.x + previous.width);
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(4);
    }

    // Help is no longer in the right-hand group.
    const right = document.querySelector(".topbar__group--right");
    expect(right).not.toBeNull();
    expect(
      [...(right as Element).querySelectorAll("*")].filter(
        (node) => node.textContent?.trim() === "Help",
      ),
    ).toHaveLength(0);
  });

  test("items have no border or background at rest and highlight while open", async () => {
    await renderTopBar();
    const file = trigger("File");
    const styles = () => {
      const style = getComputedStyle(file.element());
      return {
        background: style.backgroundColor,
        border: style.borderTopWidth,
      };
    };
    await moveMouseToCorner();
    expect(styles()).toEqual({
      background: "rgba(0, 0, 0, 0)",
      border: "0px",
    });

    await file.click();
    await expect.element(page.getByRole("menu")).toBeVisible();
    await expect.element(file).toHaveAttribute("data-state", "open");
    await moveMouseToCorner();
    await expect.poll(() => styles().background).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("arrow keys move between the triggers and open menus", async () => {
    await renderTopBar();
    const file = trigger("File");
    const edit = trigger("Edit");
    const help = trigger("Help");
    (file.element() as HTMLElement).focus();
    await expect.element(file).toHaveAttribute("tabindex", "0");

    await userEvent.keyboard("{ArrowRight}");
    await expect.element(edit).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(help).toHaveFocus();
    await expect.element(help).toHaveAttribute("tabindex", "0");
    await expect.element(file).toHaveAttribute("tabindex", "-1");
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(file).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(help).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}");
    const menu = page.getByRole("menu");
    await expect.element(menu).toBeVisible();
    await expect
      .element(menu.getByRole("menuitem", { name: "Getting Started" }))
      .toHaveFocus();

    // Right from the last menu wraps around to File's menu.
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(file).toHaveAttribute("data-state", "open");
    await expect.element(help).toHaveAttribute("data-state", "closed");
    await expect
      .element(
        page
          .getByRole("menu")
          .getByRole("menuitem", { name: "Open", exact: true }),
      )
      .toBeVisible();

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => page.getByRole("menu").elements()).toHaveLength(0);
    await expect.element(file).toHaveFocus();
  });

  test("hovering a neighbor while a menu is open switches menus", async () => {
    await renderTopBar();
    await trigger("File").click();
    await expect
      .element(
        page
          .getByRole("menu")
          .getByRole("menuitem", { name: "Open", exact: true }),
      )
      .toBeVisible();

    await trigger("Help").hover();
    await expect.element(trigger("Help")).toHaveAttribute("data-state", "open");
    await expect
      .element(trigger("File"))
      .toHaveAttribute("data-state", "closed");
    await expect.poll(() => page.getByRole("menu").elements()).toHaveLength(1);
    await expect
      .element(
        page.getByRole("menu").getByRole("menuitem", {
          name: "Getting Started",
        }),
      )
      .toBeVisible();
  });

  test("File switches between the light and dark themes", async () => {
    await renderTopBar();
    const root = document.documentElement;
    const surface = () => getComputedStyle(document.body).backgroundColor;
    const dark = surface();

    await trigger("File").click();
    await page.getByRole("menuitem", { name: "Light Theme" }).click();
    expect(root.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(getComputedStyle(root).colorScheme).toBe("light");
    expect(surface()).not.toBe(dark);

    await trigger("File").click();
    await page.getByRole("menuitem", { name: "Dark Theme" }).click();
    expect(root.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(getComputedStyle(root).colorScheme).toBe("dark");
    expect(surface()).toBe(dark);
  });

  test("Help's menu opens under its trigger and its items still work", async () => {
    await renderTopBar();
    const help = trigger("Help");
    await help.click();
    const menu = page.getByRole("menu");
    await expect.element(menu).toBeVisible();
    const helpBox = help.element().getBoundingClientRect();
    const menuBox = menu.element().getBoundingClientRect();
    expect(Math.abs(menuBox.x - helpBox.x)).toBeLessThan(2);

    await menu.getByRole("menuitem", { name: "Download Desktop App" }).click();
    await expect
      .element(
        page.getByRole("dialog", { name: "Download the zvid desktop app" }),
      )
      .toBeVisible();
    expect(
      menu.getByRole("menuitem", { name: "Check for Updates…" }).elements(),
    ).toHaveLength(0);
  });

  test("Help offers Check for Updates instead of downloads in the desktop app", async () => {
    const previous = window.harness;
    window.harness = {
      capabilities: { "native-dialogs": true },
    } as unknown as Harness;
    try {
      await renderTopBar();
      await trigger("Help").click();
      const menu = page.getByRole("menu");
      await expect
        .element(menu.getByRole("menuitem", { name: "Check for Updates…" }))
        .toBeVisible();
      expect(
        menu.getByRole("menuitem", { name: "Download Desktop App" }).elements(),
      ).toHaveLength(0);
    } finally {
      window.harness = previous;
    }
  });

  test("submenus keep their own Left/Right keys", async () => {
    await renderTopBar();
    const edit = trigger("Edit");
    await edit.click();
    const audio = page.getByRole("menuitem", { name: /^Audio/ });
    // Focus Audio without the pointer: hovering a submenu trigger starts
    // Radix's 100ms open timer, which opening with Right doesn't cancel, so
    // it could reopen the submenu just after Left closes it and take focus.
    (audio.element() as HTMLElement).focus();
    await expect.element(audio).toHaveFocus();
    expect(page.getByRole("menu").elements()).toHaveLength(1);

    // Right on a submenu trigger opens its submenu rather than Help.
    await userEvent.keyboard("{ArrowRight}");
    const submenu = page.getByRole("menu").nth(1);
    await expect.element(submenu).toBeVisible();
    await expect.element(submenu.getByRole("menuitem").first()).toHaveFocus();
    await expect.element(edit).toHaveAttribute("data-state", "open");
    await expect
      .element(trigger("Help"))
      .toHaveAttribute("data-state", "closed");

    // Left inside the submenu closes it rather than switching to File.
    await userEvent.keyboard("{ArrowLeft}");
    await expect.poll(() => page.getByRole("menu").elements()).toHaveLength(1);
    await expect.element(audio).toHaveFocus();
    await expect.element(edit).toHaveAttribute("data-state", "open");
    await expect
      .element(trigger("File"))
      .toHaveAttribute("data-state", "closed");
  });

  // Radix keeps a closed menu mounted until an animation it never saw start
  // ends, so the slide-in applies only while a menu is open. A menu closed
  // before its slide-in starts must unmount at once, rather than linger and
  // catch clicks meant for the timeline under it (#1001).
  test("a menu closed as it opens leaves nothing behind", async () => {
    await renderTopBar();
    const edit = trigger("Edit").element();
    const tick = () =>
      new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = resolve;
        channel.port2.postMessage(undefined);
      });
    const press = () =>
      edit.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
    press();
    // Wait without yielding a frame, so the animation has not started yet.
    let content: Element | null = null;
    for (let i = 0; i < 100 && !content; i++) {
      await tick();
      const candidate = document.querySelector(".dropdown-menu-content");
      if (candidate && getComputedStyle(candidate).animationName !== "none") {
        content = candidate;
      }
    }
    if (!content) throw new Error("the Edit menu never started animating");
    press();
    await tick();
    expect(content.isConnected).toBe(false);
    await expect
      .element(trigger("Edit"))
      .toHaveAttribute("data-state", "closed");
  });
});
