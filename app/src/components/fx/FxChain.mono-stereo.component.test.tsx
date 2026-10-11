import { useState } from "react";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { setViewport } from "../../component-test/viewport.ts";
import { GAIN_EFFECT_NAME } from "../../fx/effects/gain/gain.ts";
import {
  addEffect,
  createEffect,
  mapSessionEffectsToDevices,
  removeEffect,
  type SessionEffect,
  setEffectEnabled,
  setEffectParameter,
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "../../fx-stack";
import { FxChain } from "./FxChain";

// The Mono and Stereo audio effects in a source clip's FX chain: where the
// add menu lists them, their controls and defaults, and editing and
// removing them. Ported from e2e/mono.spec.ts and e2e/stereo.spec.ts,
// which keep Stereo's effect on the preview's mix and on an export.
const TRACK_STACK = sourceTrackEffectTrackId("track-1");
const CLIP_STACK = sourceClipEffectTrackId("span-1");
const clipDevices = '.fx-chain .fx-device-panel[data-fx-group="clip"]';
const noop = () => {};

// The chain for a selected source clip of `kind` media, editing its
// effects as the app does. A clip with sound starts with its Gain.
function Chain({ kind }: { kind: "audio" | "video" }) {
  const [effects, setEffects] = useState<SessionEffect[]>(() =>
    kind === "audio" ? [createEffect(CLIP_STACK, GAIN_EFFECT_NAME)] : [],
  );
  return (
    <div className="app-shell">
      <FxChain
        clipTrackId={CLIP_STACK}
        devices={mapSessionEffectsToDevices(
          effects,
          TRACK_STACK,
          "Track 1",
          [],
          new Set(),
          CLIP_STACK,
        )}
        kind={kind}
        layerLabel="Track"
        layerName="Track 1"
        layerTrackId={TRACK_STACK}
        onAdd={(trackId, effectName, id) =>
          setEffects((current) =>
            addEffect(current, trackId, effectName, undefined, id),
          )
        }
        onClearAll={noop}
        onCopy={noop}
        onCut={noop}
        onDuplicate={noop}
        onMove={noop}
        onMoveToStack={noop}
        onPaste={noop}
        onRemove={(device) =>
          setEffects((current) => removeEffect(current, device.id))
        }
        onReset={noop}
        onSetEnabled={(device, enabled) =>
          setEffects((current) => setEffectEnabled(current, device.id, enabled))
        }
        onSetParameter={(device, key, value) =>
          setEffects((current) =>
            setEffectParameter(current, device.id, key, value),
          )
        }
      />
    </div>
  );
}

function deviceLabels() {
  return [...document.querySelectorAll(clipDevices)].map((device) =>
    device.getAttribute("aria-label"),
  );
}

// Opens the clip's add menu and picks `name` from the Volume & Stereo
// submenu, opened from the keyboard, of the menu's `group` when it has
// one.
async function addFromVolumeMenu(name: RegExp, group?: string) {
  await page.getByRole("button", { name: "Add device to this clip" }).click();
  const menu = page.getByRole("menu");
  const scope = group ? menu.getByRole("group", { name: group }) : menu;
  const category = scope.getByRole("menuitem", { name: "Volume & Stereo" });
  await expect.element(category).toBeVisible();
  category.element().focus();
  await userEvent.keyboard("{ArrowRight}");
  await page.getByRole("menuitem", { name }).click();
}

// The device panel named `name`.
function device(name: string) {
  return page.getByRole("region", { name, exact: true });
}

describe("Mono", () => {
  test("Mono adds to an audio clip with Sum at 100 %", async () => {
    await setViewport({ width: 1600, height: 1200 });
    await render(<Chain kind="audio" />);
    expect(deviceLabels()).toEqual(["Gain"]);

    await addFromVolumeMenu(/^Mono/);
    await expect.poll(deviceLabels).toEqual(["Gain", "Mono"]);
    const mono = device("Mono");
    await expect
      .element(mono.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    expect(
      mono.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(0);

    const source = mono.getByRole("group", { name: "Source" });
    expect(
      source
        .getByRole("button")
        .elements()
        .map((button) => button.textContent),
    ).toEqual(["Sum", "Left", "Right"]);
    await expect
      .element(source.getByRole("button", { name: "Sum" }))
      .toHaveAttribute("aria-pressed", "true");
    const amount = mono.getByRole("slider", { name: "Amount" });
    await expect.element(amount).toHaveAttribute("aria-valuetext", "100%");

    // Picking a side and turning Amount down.
    await source.getByRole("button", { name: "Left" }).click();
    await expect
      .element(source.getByRole("button", { name: "Left" }))
      .toHaveAttribute("aria-pressed", "true");
    amount.element().focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(amount).toHaveAttribute("aria-valuetext", "99%");

    // Removing it leaves the Gain.
    await mono.getByRole("button", { name: "Remove Mono" }).click();
    await expect.poll(deviceLabels).toEqual(["Gain"]);
  });

  test("a video clip's add menu lists Mono in its Audio group", async () => {
    await setViewport({ width: 1600, height: 1200 });
    await render(<Chain kind="video" />);

    await page.getByRole("button", { name: "Add device to this clip" }).click();
    const menu = page.getByRole("menu");
    await expect.element(menu.getByRole("group", { name: "Audio" })).toBeVisible();
    expect(
      menu
        .getByRole("group", { name: "Video" })
        .getByRole("menuitem", { name: "Volume & Stereo" })
        .elements(),
    ).toHaveLength(0);
    await userEvent.keyboard("{Escape}");

    await addFromVolumeMenu(/^Mono/, "Audio");
    await expect.poll(deviceLabels).toEqual(["Mono"]);
  });
});

describe("Stereo", () => {
  test("a video clip lists Stereo in its add menu's Audio group", async () => {
    await setViewport({ width: 1600, height: 1200 });
    await render(<Chain kind="video" />);

    await addFromVolumeMenu(/^Stereo/, "Audio");
    await expect.poll(deviceLabels).toEqual(["Stereo"]);
  });

  test("Stereo adds with Width at 100% and Pan centered, and Home pans it hard left", async () => {
    await setViewport({ width: 1600, height: 1200 });
    await render(<Chain kind="audio" />);

    // A clip with only sound lists the audio effects alone.
    await page.getByRole("button", { name: "Add device to this clip" }).click();
    await expect
      .element(page.getByRole("menuitem", { name: "Volume & Stereo" }))
      .toBeVisible();
    expect(
      page.getByRole("menu").getByRole("group", { name: "Video" }).elements(),
    ).toHaveLength(0);
    await userEvent.keyboard("{Escape}");

    await addFromVolumeMenu(/^Stereo/);
    await expect.poll(deviceLabels).toEqual(["Gain", "Stereo"]);
    const stereo = device("Stereo");
    await expect
      .element(stereo.getByRole("img", { name: "Audio effect" }))
      .toBeVisible();
    expect(
      stereo.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(0);
    await expect
      .element(stereo.getByRole("slider", { name: "Width" }))
      .toHaveAttribute("aria-valuetext", "100%");
    const pan = stereo.getByRole("slider", { name: "Pan" });
    await expect.element(pan).toHaveAttribute("aria-valuetext", "C");

    // Home is the knob's minimum.
    pan.element().focus();
    await userEvent.keyboard("{Home}");
    await expect.element(pan).toHaveAttribute("aria-valuetext", "L 100");
  });
});
