import { expect, test } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { PREVIEW_DEFAULT_WIDTH } from "../../app/constants.ts";
import { DesktopShell } from "../../component-test/shells.tsx";
import { setViewport } from "../../component-test/viewport.ts";
import { PROGRAM_FRAME_ID } from "../../fx-shaders/frame-analysis.ts";
import { ScopesPane, useScopesPane } from "./ScopesPane";
import "../preview-panel.css";

// The preview's Scopes pane (#1152, #1165) below an empty monitor in a
// preview of the default width: its scope names, the room it shares with
// the monitor and its splitter. Ported from e2e/scopes-pane.spec.ts, which
// keeps the Scopes button, the program picture and the Media tab.
function Preview({
  frameId = PROGRAM_FRAME_ID,
  emptyMessage = "",
}: {
  frameId?: string | null;
  emptyMessage?: string;
}) {
  const pane = useScopesPane();
  return (
    <DesktopShell>
      <aside
        className="preview-panel"
        style={{ flex: 1, width: PREVIEW_DEFAULT_WIDTH }}
      >
        <div className="preview-monitor" />
        <ScopesPane
          emptyMessage={emptyMessage}
          frameId={frameId}
          pane={pane}
        />
      </aside>
    </DesktopShell>
  );
}

function box(selector: string) {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`${selector} is not rendered`);
  }
  return element.getBoundingClientRect();
}

// Real input through the DevTools protocol, so the splitter's pointer
// capture behaves as with a mouse.
async function mouse(
  type: "mouseMoved" | "mousePressed" | "mouseReleased",
  x: number,
  y: number,
) {
  const frame = window.frameElement?.getBoundingClientRect();
  await cdp().send("Input.dispatchMouseEvent", {
    type,
    x: x + (frame?.left ?? 0),
    y: y + (frame?.top ?? 0),
    button: "left",
    buttons: type === "mouseReleased" ? 0 : 1,
    clickCount: 1,
  });
}

// Drags the splitter from its middle to `toY`, in four steps.
async function dragSplitter(toY: number) {
  const edge = box(".scopes-pane__resize");
  const x = edge.x + edge.width / 2;
  const fromY = edge.y + edge.height / 2;
  await mouse("mouseMoved", x, fromY);
  await mouse("mousePressed", x, fromY);
  for (let step = 1; step <= 4; step++) {
    await mouse("mouseMoved", x, fromY + ((toY - fromY) * step) / 4);
  }
  await mouse("mouseReleased", x, toY);
  await new Promise(requestAnimationFrame);
}

test("every scope's name fits the default preview width, uncut", async () => {
  await setViewport({ width: 1600, height: 1000 });
  await render(<Preview />);

  const pane = box(".scopes-pane");
  const kinds = page.getByRole("toolbar", { name: "Scope" });
  const kindsBox = kinds.element().getBoundingClientRect();
  expect(kindsBox.x + kindsBox.width).toBeLessThanOrEqual(
    pane.x + pane.width,
  );
  const buttons = kinds.getByRole("button").elements();
  expect(buttons).toHaveLength(4);
  for (const kind of buttons) {
    expect(kind.scrollWidth <= kind.clientWidth).toBe(true);
  }

  // Each names the canvas it shows.
  for (const name of ["Parade", "Vectorscope", "Histogram", "Waveform"]) {
    await kinds.getByRole("button", { name, exact: true }).click();
    await expect
      .element(page.getByRole("img", { name, exact: true }))
      .toHaveClass("scopes-pane__canvas");
  }
});

test("the splitter trades height between the pane and the monitor", async () => {
  await setViewport({ width: 1600, height: 1000 });
  await render(<Preview />);

  // Below the monitor, sharing the room evenly with it.
  const panel = box(".preview-panel");
  const monitor = box(".preview-monitor");
  const pane = box(".scopes-pane");
  expect(pane.y).toBeGreaterThanOrEqual(monitor.y + monitor.height);
  expect(Math.abs(pane.height - monitor.height)).toBeLessThan(3);

  // The splitter fills the gap between the two.
  const edge = box(".scopes-pane__resize");
  expect(edge.y).toBeGreaterThanOrEqual(monitor.y + monitor.height - 1);
  expect(edge.y + edge.height).toBeLessThanOrEqual(pane.y + 1);

  // Down shrinks the pane, up grows it until the monitor is at its least
  // height, and far down leaves the pane at its own least height.
  await dragSplitter(edge.y + edge.height / 2 + 30);
  expect(
    Math.abs(box(".scopes-pane").height - (pane.height - 30)),
  ).toBeLessThan(3);
  expect(
    Math.abs(box(".preview-monitor").height - (monitor.height + 30)),
  ).toBeLessThan(3);
  await dragSplitter(panel.y - 200);
  expect(Math.abs(box(".preview-monitor").height - 140)).toBeLessThan(3);
  expect(box(".scopes-pane").height).toBeGreaterThan(pane.height);
  await dragSplitter(panel.y + panel.height + 200);
  expect(Math.abs(box(".scopes-pane").height - 96)).toBeLessThan(3);
});

test("with nothing to analyze the pane shows its message in place of the canvas", async () => {
  await render(
    <Preview
      emptyMessage="Audio only: there is no picture to analyze."
      frameId={null}
    />,
  );

  const pane = page.getByRole("region", { name: "Scopes", exact: true });
  expect(pane.element().querySelector(".scopes-pane__empty")?.textContent).toBe(
    "Audio only: there is no picture to analyze.",
  );
  const canvas = document.querySelector<HTMLElement>(".scopes-pane__canvas");
  expect(canvas?.hidden).toBe(true);
  expect(canvas?.getBoundingClientRect().height).toBe(0);
});
