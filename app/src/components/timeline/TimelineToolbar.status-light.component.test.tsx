import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { signatureById } from "../../app/constants.ts";
import { DesktopShell } from "../../component-test/shells.tsx";
import { createPlayheadSignal } from "../../playhead-signal.ts";
import { TimelineToolbar } from "./TimelineToolbar";

// The toolbar's status light follows the transport (#1097): yellow when
// stopped, green while playing, red while recording.

const YELLOW = "rgb(246, 183, 60)";
const GREEN = "rgb(63, 198, 107)";
const RED = "rgb(239, 68, 68)";

const noop = () => {};

type Transport = { isPlaying: boolean; isRecording: boolean };

function Toolbar({ isPlaying, isRecording }: Transport) {
  return (
    <DesktopShell>
      <TimelineToolbar
        playheadSignal={createPlayheadSignal()}
        bpm={120}
        fps={30}
        signature={signatureById("4/4")}
        timelineMode="musical"
        snapEnabled
        signatureId="4/4"
        commitProjectChange={noop}
        commitProjectPatch={noop}
        isMediaDrawerOpen={false}
        mediaDrawerTab="media"
        onSelectMediaDrawerTab={noop}
        isPlaying={isPlaying}
        isRecording={isRecording}
      />
    </DesktopShell>
  );
}

async function expectLight(label: string, color: string) {
  const light = page.getByRole("img", { name: label });
  await expect.element(light).toBeVisible();
  const element = light.element();
  expect(element.matches(".timeline-toolbar .status-light")).toBe(true);
  expect(element.getAttribute("role")).toBe("img");
  expect(element.getAttribute("title")).toBe(label);
  await expect
    .poll(() => getComputedStyle(element).backgroundImage)
    .toContain(color);
}

describe("TimelineToolbar status light", () => {
  test("is yellow when stopped and green while playing", async () => {
    const screen = await render(
      <Toolbar isPlaying={false} isRecording={false} />,
    );
    await expectLight("Stopped", YELLOW);
    await screen.rerender(<Toolbar isPlaying isRecording={false} />);
    await expectLight("Playing", GREEN);
    await screen.rerender(<Toolbar isPlaying={false} isRecording={false} />);
    await expectLight("Stopped", YELLOW);
  });

  // Recording also plays; stopping the recording keeps playback going.
  test("is red while recording and yellow once stopped", async () => {
    const screen = await render(<Toolbar isPlaying isRecording />);
    await expectLight("Recording", RED);
    await screen.rerender(<Toolbar isPlaying isRecording={false} />);
    await expectLight("Playing", GREEN);
    await screen.rerender(<Toolbar isPlaying={false} isRecording={false} />);
    await expectLight("Stopped", YELLOW);
  });
});
