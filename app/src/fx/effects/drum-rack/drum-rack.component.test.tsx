import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { type Locator, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { patchProjectState } from "../../../app/session-project.ts";
import { selectSourceSpan } from "../../../app/source-selection.ts";
import type { ProjectState } from "../../../app/types.ts";
import "../../../components/fx/controls/DrumRackControl.tsx";
import { addFromMenu } from "../../../component-test/fx-actions.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  mediaItem,
  withDroppedMedia,
} from "../../../component-test/fx-projects.ts";
import { undo } from "../../../component-test/input.ts";
import { createMidiClip } from "../../../source-clip-edits.ts";
import { setDrumSampleImporter, setDrumSampleMedia } from "./drum-media.ts";
import {
  DRUM_RACK_EFFECT_NAME,
  DRUM_RACK_KEY,
  parseDrumRack,
} from "./drum-rack.ts";

// The Drum Rack (#1407): a MIDI clip's instrument of 16 pads, which light
// and play when pressed, load their own samples, and switch banks, each
// bank's samples fetched only once a pad plays them.

// A project with a MIDI clip "drums" on the source track an audio drop
// made, and that clip's selection.
function midiProject() {
  const dropped = withDroppedMedia(
    EMPTY_PROJECT,
    mediaItem({ kind: "audio", durationSeconds: 2 }),
  );
  const patch = createMidiClip(
    dropped.project,
    dropped.span.sourceTrackId,
    16,
    16,
    "drums",
  );
  if (!patch) {
    throw new Error("No room for the MIDI clip");
  }
  return {
    project: patchProjectState(dropped.project, patch),
    selection: {
      source: selectSourceSpan({
        id: "drums",
        sourceTrackId: dropped.span.sourceTrackId,
      }),
    },
  };
}

const fetched: string[] = [];
const fetchBefore = window.fetch;

beforeEach(() => {
  fetched.length = 0;
  window.fetch = (input, init) => {
    fetched.push(String(input instanceof Request ? input.url : input));
    return fetchBefore(input, init);
  };
});

afterEach(() => {
  window.fetch = fetchBefore;
  setDrumSampleMedia([]);
  setDrumSampleImporter(undefined);
});

// The drum bank files fetched so far, as `<bank>/<file>`.
const bankFetches = () =>
  fetched
    .filter((url) => url.includes("/drum-banks/"))
    .map((url) => url.replace(/^.*\/drum-banks\//, ""));

async function openRack() {
  const { project: initial, selection } = midiProject();
  let project: ProjectState = initial;
  await render(
    <FxEditor
      project={project}
      selection={selection}
      onChange={(history) => {
        project = history.present;
      }}
    />,
  );
  await addFromMenu("Add device to this clip", "MIDI", /^Drum Rack/, "MIDI");
  const rack = page.getByRole("region", {
    name: DRUM_RACK_EFFECT_NAME,
    exact: true,
  });
  await expect
    .element(rack.getByRole("button", { name: /^Pad 1:/ }))
    .toBeVisible();
  const settings = () =>
    parseDrumRack(
      project.effects
        .find((effect) => effect.effectName === DRUM_RACK_EFFECT_NAME)
        ?.parameters.find((parameter) => parameter.key === DRUM_RACK_KEY)
        ?.value,
    );
  return { rack, settings };
}

const pad = (rack: Locator, number: number) =>
  rack.getByRole("button", { name: new RegExp(`^Pad ${number}:`) });

describe("Drum Rack", { timeout: 60_000 }, () => {
  test("lays out 16 pads from the bottom left and lights and plays a pressed one, fetching its sample only then", async () => {
    const { rack } = await openRack();
    const pads = rack.getByRole("button", { name: /^Pad \d+:/ }).elements();
    expect(pads.map((element) => element.getAttribute("aria-label"))).toEqual([
      "Pad 13: High Tom",
      "Pad 14: Cymbal",
      "Pad 15: High Conga",
      "Pad 16: Cowbell",
      "Pad 9: Maracas",
      "Pad 10: Mid Tom",
      "Pad 11: Open Hat",
      "Pad 12: Mid Conga",
      "Pad 5: Snare Snappy",
      "Pad 6: Low Tom",
      "Pad 7: Closed Hat",
      "Pad 8: Low Conga",
      "Pad 1: Kick",
      "Pad 2: Rimshot",
      "Pad 3: Snare",
      "Pad 4: Clap",
    ]);
    // Showing the rack fetches none of its samples.
    expect(bankFetches()).toEqual([]);

    await userEvent.click(pad(rack, 1));
    await expect.element(pad(rack, 1)).toHaveAttribute("data-hit");
    await expect.poll(bankFetches).toEqual(["tr-808/01-kick.wav"]);
    // The light goes out again.
    await expect.element(pad(rack, 1)).not.toHaveAttribute("data-hit");

    // From the keyboard, too.
    (pad(rack, 4).element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(pad(rack, 4)).toHaveAttribute("data-hit");
    await expect
      .poll(bankFetches)
      .toEqual(["tr-808/01-kick.wav", "tr-808/04-clap.wav"]);
  });

  test("switching the bank remaps every pad, as one undo step", async () => {
    const { rack, settings } = await openRack();
    await userEvent.click(rack.getByRole("button", { name: "Bank: TR-808" }));
    await userEvent.click(
      page.getByRole("menuitemcheckbox", { name: "TR-909" }),
    );
    await expect.element(pad(rack, 16)).toHaveAccessibleName("Pad 16: Ride");
    await expect.element(pad(rack, 1)).toHaveAccessibleName("Pad 1: Kick");
    expect(settings().bank).toBe("builtin:tr-909");

    await userEvent.click(pad(rack, 16));
    await expect.poll(bankFetches).toEqual(["tr-909/16-ride.wav"]);

    await undo();
    await expect.element(pad(rack, 16)).toHaveAccessibleName("Pad 16: Cowbell");
    expect(settings().bank).toBe("builtin:tr-808");
  });

  test("a pad loads its own sample from a file or the media library, and goes back to its bank's", async () => {
    const { rack, settings } = await openRack();
    const imported: (readonly File[] | undefined)[] = [];
    setDrumSampleImporter(async (files) => {
      imported.push(files);
      return "samples/my-kick.wav";
    });

    await userEvent.click(rack.getByRole("button", { name: "Pad 1 sample" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Load file…" }));
    await expect
      .element(pad(rack, 1))
      .toHaveAccessibleName("Pad 1: my-kick.wav");
    expect(imported).toEqual([undefined]);
    expect(settings().pads[0]).toBe("samples/my-kick.wav");
    // Until the app has the file, the pad is flagged and silent.
    expect(pad(rack, 1).element().parentElement?.className).toContain(
      "is-offline",
    );

    setDrumSampleMedia([
      mediaItem({
        kind: "audio",
        name: "my-kick.wav",
        sourcePath: "samples/my-kick.wav",
        previewUrl: "/drum-banks/tr-909/01-kick.wav",
      }),
      mediaItem({
        kind: "audio",
        name: "vox.wav",
        previewUrl: "/drum-banks/cr-78/04-guiro.wav",
      }),
    ]);
    await expect
      .poll(() => pad(rack, 1).element().parentElement?.className)
      .not.toContain("is-offline");
    await userEvent.click(pad(rack, 1));
    await expect.poll(bankFetches).toEqual(["tr-909/01-kick.wav"]);

    // Picked from the media library.
    await userEvent.click(rack.getByRole("button", { name: "Pad 2 sample" }));
    await userEvent.click(
      page.getByRole("menuitemcheckbox", { name: "vox.wav" }),
    );
    await expect.element(pad(rack, 2)).toHaveAccessibleName("Pad 2: vox.wav");

    // Back to the bank's sample.
    await userEvent.click(rack.getByRole("button", { name: "Pad 1 sample" }));
    await userEvent.click(
      page.getByRole("menuitemcheckbox", { name: "TR-808: Kick" }),
    );
    await expect.element(pad(rack, 1)).toHaveAccessibleName("Pad 1: Kick");
    expect(settings().pads.slice(0, 2)).toEqual([undefined, "vox.wav"]);
  });
});
