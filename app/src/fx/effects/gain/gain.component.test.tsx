import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { selectSourceSpan } from "../../../app/source-selection.ts";
import type { ProjectState } from "../../../app/types.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  mediaItem,
  withClipFromSpan,
  withDroppedMedia,
} from "../../../component-test/fx-projects.ts";
import { centerOf, mouse } from "../../../component-test/mouse.ts";

// Every clip with sound gets a Gain audio effect at 0 dB in its own stack,
// shown with a vertical fader and a Mute toggle. Clips without sound get
// none, and a removed Gain stays removed.

const clipDevices = '.fx-chain .fx-device-panel[data-fx-group="clip"]';
const devices = () => document.querySelectorAll(clipDevices);

describe("Gain", { timeout: 60_000 }, () => {
  test("a new audio clip has a Gain with a vertical fader at 0 dB", async () => {
    const dropped = withDroppedMedia(
      EMPTY_PROJECT,
      mediaItem({ kind: "audio" }),
    );
    let project: ProjectState = dropped.project;
    const screen = await render(
      <FxEditor
        project={project}
        selection={{ source: selectSourceSpan(dropped.span) }}
        onChange={(history) => {
          project = history.present;
        }}
      />,
    );

    expect(devices()).toHaveLength(1);
    await expect
      .element(page.elementLocator(devices()[0]))
      .toHaveAttribute("aria-label", "Gain");
    await expect
      .element(
        page
          .elementLocator(devices()[0])
          .getByRole("img", { name: "Audio effect" }),
      )
      .toBeVisible();
    // Audio effects have no Animation modifier.
    expect(
      page
        .elementLocator(devices()[0])
        .getByRole("button", { name: /Turn Animation/ })
        .elements(),
    ).toHaveLength(0);

    const panel = () => page.elementLocator(devices()[0]);
    const fader = () => panel().getByRole("slider", { name: "Gain" });
    await expect
      .element(fader())
      .toHaveAttribute("aria-orientation", "vertical");
    await expect.element(fader()).toHaveAttribute("aria-valuetext", "0.0 dB");

    // Dragging to the bottom mutes it.
    const { x, y, box } = centerOf(fader().element());
    await mouse.move(x, y);
    await mouse.down();
    await mouse.move(x, box.bottom + 40, { steps: 6 });
    await mouse.up();
    await expect.element(fader()).toHaveAttribute("aria-valuetext", "Mute");
    await expect
      .element(panel().getByRole("button", { name: /^Gain: Mute/ }))
      .toHaveTextContent("Mute");

    // Double-click resets it to 0 dB; arrow keys step it.
    await userEvent.dblClick(fader());
    await expect.element(fader()).toHaveAttribute("aria-valuetext", "0.0 dB");
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(fader()).toHaveAttribute("aria-valuetext", "−1.0 dB");

    // Typing into the readout sets it.
    await userEvent.click(panel().getByRole("button", { name: /^Gain: / }));
    const input = panel().getByRole("textbox", { name: "Gain value" });
    await userEvent.fill(input, "-6");
    await userEvent.keyboard("{Enter}");
    await expect.element(fader()).toHaveAttribute("aria-valuetext", "−6.0 dB");

    // The Mute toggle.
    const mute = panel().getByRole("button", { name: "Mute Gain" });
    await expect.element(mute).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(mute);
    await expect.element(mute).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(mute);
    await expect.element(mute).toHaveAttribute("aria-pressed", "false");

    // A layer clip made from the source clip gets its own Gain.
    const added = withClipFromSpan(project, dropped.span);
    await screen.rerender(
      <FxEditor
        key="layer-clip"
        project={added.project}
        selection={{ clipId: added.clip.id }}
      />,
    );
    expect(devices()).toHaveLength(1);
    await expect.element(fader()).toHaveAttribute("aria-valuetext", "0.0 dB");

    // Removing Gain leaves the clip without one, and the add menu, which
    // offers an audio clip only audio effects, brings it back.
    await userEvent.click(panel().getByRole("button", { name: "Remove Gain" }));
    await expect.poll(() => devices().length).toBe(0);
    await userEvent.click(
      page.getByRole("button", { name: "Add device to this clip" }).first(),
    );
    const menu = page.getByRole("menu");
    expect(
      menu.getByRole("menuitem", { name: "Stylize" }).elements(),
    ).toHaveLength(0);
    menu.getByRole("menuitem", { name: "Volume & Stereo" }).element().focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect
      .element(page.getByRole("menuitem", { name: /^Gain/ }))
      .toBeVisible();
    await userEvent.click(page.getByRole("menuitem", { name: /^Gain/ }));
    await expect.poll(() => devices().length).toBe(1);
    await expect.element(fader()).toHaveAttribute("aria-valuetext", "0.0 dB");
  });

  test("a video clip without sound gets no Gain", async () => {
    const dropped = withDroppedMedia(
      EMPTY_PROJECT,
      mediaItem({ kind: "video", hasAudio: false }),
    );
    await render(
      <FxEditor
        project={dropped.project}
        selection={{ source: selectSourceSpan(dropped.span) }}
      />,
    );

    await expect
      .poll(() => document.querySelector(".fx-panel__toggle")?.textContent)
      .toMatch(/^Clip /);
    expect(devices()).toHaveLength(0);

    // Its add menu lists the audio effects in their own group.
    await userEvent.click(
      page.getByRole("button", { name: "Add device to this clip" }).first(),
    );
    const menu = page.getByRole("menu");
    await expect
      .element(menu.getByRole("group", { name: "Video" }))
      .toBeVisible();
    menu
      .getByRole("group", { name: "Audio" })
      .getByRole("menuitem", { name: "Volume & Stereo" })
      .element()
      .focus();
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.click(page.getByRole("menuitem", { name: /^Gain/ }));
    await expect.poll(() => devices().length).toBe(1);
  });
});
