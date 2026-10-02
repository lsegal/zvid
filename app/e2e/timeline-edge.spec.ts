import { expect, type Page, test } from "@playwright/test";

// The timeline sits flush against the window's left edge (just inside the
// panel's 1px border), with square left
// corners, whether the FX row is open or not. In the wide layout it also sits
// on the transport bar; the narrow one stacks the preview under it instead.

async function timelineEdges(page: Page) {
  return page.locator(".timeline-scroll").evaluate((node) => {
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const transport = document.querySelector(".transport-bar");
    return {
      left: box.left,
      bottom: box.bottom,
      transportTop: transport?.getBoundingClientRect().top ?? Number.NaN,
      borderLeft: style.borderLeftWidth,
      topLeft: style.borderTopLeftRadius,
      bottomLeft: style.borderBottomLeftRadius,
      topRight: style.borderTopRightRadius,
    };
  });
}

async function expectFlush(page: Page, onTransport: boolean) {
  const edges = await timelineEdges(page);
  expect(edges.left).toBeLessThanOrEqual(1);
  if (onTransport) {
    expect(Math.abs(edges.bottom - edges.transportTop)).toBeLessThan(1);
  }
  expect(edges.borderLeft).toBe("0px");
  expect(edges.topLeft).toBe("0px");
  expect(edges.bottomLeft).toBe("0px");
  expect(edges.topRight).toBe("18px");
}

for (const { onTransport, ...viewport } of [
  { width: 1440, height: 900, onTransport: true },
  { width: 800, height: 1000, onTransport: false },
]) {
  test(`the timeline is flush with the window's left edge at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
    await expectFlush(page, onTransport);

    // The FX row shares the workspace column and lines up with it.
    const fxLeft = () =>
      page
        .locator(".fx-panel")
        .evaluate((node) => node.getBoundingClientRect().left);
    expect(await fxLeft()).toBe(0);

    const toggle = page.locator(".fx-panel__toggle");
    const expanded = await toggle.getAttribute("aria-expanded");
    await toggle.click();
    await expect(toggle).not.toHaveAttribute("aria-expanded", expanded ?? "");
    await expectFlush(page, onTransport);
    expect(await fxLeft()).toBe(0);
  });
}
