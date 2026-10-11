import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import indexHtml from "../../index.html?raw";
import { DesktopShell } from "../component-test/shells.tsx";
import { BrandMark } from "./BrandMark";

// The zvid logo (#1070): the top bar's brand mark, and the favicon.

const noop = () => {};

async function renderBrandMark() {
  const screen = await render(
    <DesktopShell>
      <header className="topbar">
        <BrandMark onStatus={noop} />
      </header>
    </DesktopShell>,
  );
  const mark = screen.container.querySelector(".brand-mark");
  const logo = mark?.querySelector("svg");
  const name = mark?.querySelector(".brand-mark__name");
  if (!mark || !logo || !name) throw new Error("the brand mark is missing");
  return { mark, logo, name };
}

describe("BrandMark", () => {
  test("shows the zvid logo beside the wordmark", async () => {
    const { logo, name } = await renderBrandMark();
    expect(logo.getAttribute("viewBox")).toBe("-8 -8 258 212");
    expect(logo.getAttribute("aria-hidden")).toBe("true");
    expect(logo.querySelectorAll("path")).toHaveLength(3);
    expect(logo.querySelectorAll("circle")).toHaveLength(0);

    // About 24 × 20 px, in the logo's aspect, centered on the wordmark.
    const logoBox = logo.getBoundingClientRect();
    const nameBox = name.getBoundingClientRect();
    expect(logoBox.height).toBeCloseTo(20, 0);
    expect(logoBox.width).toBeCloseTo((20 * 258) / 212, 0);
    expect(logoBox.x + logoBox.width).toBeLessThan(nameBox.x);
    expect(
      Math.abs(
        logoBox.y + logoBox.height / 2 - (nameBox.y + nameBox.height / 2),
      ),
    ).toBeLessThan(3);
  });

  test("draws the logo in the brand purple and the wordmark in the primary text color", async () => {
    const { logo, name } = await renderBrandMark();
    expect(getComputedStyle(logo).fill).toBe("rgb(178, 130, 255)");
    expect(getComputedStyle(logo).opacity).toBe("1");
    expect(getComputedStyle(name).color).toBe("rgb(238, 242, 255)");
  });

  test("matches the favicon, the white zvid logo on the purple square", async () => {
    const icon = new DOMParser()
      .parseFromString(indexHtml, "text/html")
      .querySelector<HTMLLinkElement>('link[rel="icon"]');
    const href = icon?.getAttribute("href");
    expect(href).toBeTruthy();
    // The test server answers /favicon.svg with Vitest's own icon, so
    // fetch the app's public file by its path instead. (Vite would rewrite
    // a `new URL(…, import.meta.url)` written out in full.)
    const testFileUrl = import.meta.url;
    const file = new URL(`../../public${href}`, testFileUrl);
    const response = await fetch(`/@fs${file.pathname}`);
    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    const svg = await response.text();
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg).toMatch(/<rect\b[^>]*rx="\d+" fill="#863bff"/);
    expect(svg).toContain('<g fill="#fff"');
    expect(svg.match(/<path\b/g)).toHaveLength(3);
    expect(svg).not.toContain("<ellipse");
  });
});
