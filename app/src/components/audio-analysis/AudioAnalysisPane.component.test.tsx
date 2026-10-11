import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { DesktopShell } from "../../component-test/shells.tsx";
import { setViewport } from "../../component-test/viewport.ts";
import { AudioAnalysisPane } from "./AudioAnalysisPane";
import "../preview-panel.css";

// The preview's audio analysis area: a spectrogram of the program mix with
// a vertical master VU meter at its right edge. Ported from
// audio-analysis.spec.ts, which keeps the Audio toggle, the area's place
// below the monitor and what it draws from real playback (in WebKit too).

function rect(selector: string) {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`No ${selector}`);
  }
  return element.getBoundingClientRect();
}

function leftLevel() {
  return Number(
    document
      .querySelector('.audio-analysis [aria-label="Left level"]')
      ?.getAttribute("aria-valuenow"),
  );
}

test("the meter is vertical at the right edge of the spectrogram", async () => {
  await setViewport({ width: 1400, height: 900 });
  // In the preview panel's column, as PreviewPanel shows it.
  await render(
    <DesktopShell>
      <aside className="preview-panel" style={{ width: 560, height: 700 }}>
        <AudioAnalysisPane isPlaying={false} getMeterTap={() => null} />
      </aside>
    </DesktopShell>,
  );

  const area = rect(".audio-analysis");
  const spectrogram = rect(".spectrogram");
  const bars = rect(".vu-meter__bars");
  expect(bars.x).toBeGreaterThanOrEqual(spectrogram.x + spectrogram.width);
  expect(area.x + area.width - (bars.x + bars.width)).toBeLessThan(40);
  // The meter is vertical.
  expect(bars.height).toBeGreaterThan(bars.width * 2);
  expect(leftLevel()).toBe(-60);
});
