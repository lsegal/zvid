import {
  afterEach,
  beforeEach,
  expect,
  onTestFinished,
  test,
  vi,
} from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  nextFrame,
  query,
  queryAll,
  renderApp,
} from "../../component-test/app.tsx";
import { computerKeyboardEntry } from "../../midi-input/computer-keyboard.ts";
import {
  type MidiAccessLike,
  type MidiInputPort,
  midiInputHub,
} from "../../midi-input/input-hub.ts";
import { disarmAllTracks } from "../../recording/record-arm.ts";
import {
  DEFAULT_RECORD_SOURCE_PREFS,
  setRecordSourcePrefs,
} from "../../recording/record-source.ts";

// Recording MIDI (#1587): with MIDI on, the Record panel offers MIDI instead
// of video and audio, and an armed track then records a MIDI clip live, from
// the chosen device or the typing keyboard, without any camera or mic prompt.
const TEST_TIMEOUT = 60_000;
const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const LIVE_NOTES = "[data-live-recording-track-id] .source-span__midi-note";
const MEDIA_PICKER = ".record-input-picker";
const CLIP_NOTES = "[data-source-span-id] .source-span__midi-note";

const port: MidiInputPort = {
  id: "keys",
  name: "Test Keys",
  state: "connected",
  onmidimessage: null,
};
const access: MidiAccessLike = {
  inputs: { values: () => [port] },
  onstatechange: null,
};
let getUserMedia: ReturnType<typeof vi.fn>;

function send(status: number, pitch: number, velocity: number) {
  port.onmidimessage?.({ data: new Uint8Array([status, pitch, velocity]) });
}

beforeEach(() => {
  getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    const canvas = document.createElement("canvas");
    const audio = new AudioContext();
    return new MediaStream([
      ...(constraints.video ? canvas.captureStream(1).getVideoTracks() : []),
      ...(constraints.audio
        ? audio.createMediaStreamDestination().stream.getAudioTracks()
        : []),
    ]);
  });
  navigator.mediaDevices.getUserMedia =
    getUserMedia as typeof navigator.mediaDevices.getUserMedia;
  (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess = async () =>
    access;
});

afterEach(() => {
  disarmAllTracks();
  midiInputHub.setEnabled(false);
  computerKeyboardEntry.setEnabled(false);
  setRecordSourcePrefs(DEFAULT_RECORD_SOURCE_PREFS);
});

// A session with one source track, with the Record panel open.
async function openEditor() {
  await renderApp();
  await page
    .getByRole("button", { name: "Track", exact: true })
    .first()
    .click();
  await expect
    .poll(() => queryAll(".track-row--source[data-source-track-id]").length)
    .toBe(1);
  await page.getByRole("button", { name: "Record", exact: true }).click();
}

const armButton = () =>
  page.getByRole("button", { name: /^Arm .* for (MIDI )?recording$/ }).first();
const recordButton = () =>
  page.getByRole("button", { name: "Record armed tracks" });
const stopButton = () => page.getByRole("button", { name: "Stop recording" });
const tab = (name: string) => page.getByRole("tab", { name });

async function chooseMidiTab() {
  midiInputHub.setEnabled(true);
  await tab("MIDI").click();
  // Opening the panel on Video/Audio previews the camera and mic; from here
  // on nothing may ask for them.
  await expect.element(page.getByLabelText("Quantize")).toBeVisible();
  getUserMedia.mockClear();
}

test(
  "the MIDI tab appears with MIDI on, and Video/Audio stays the default",
  async () => {
    await openEditor();
    await expect.element(tab("Video/Audio")).not.toBeInTheDocument();
    await expect.poll(() => queryAll(MEDIA_PICKER).length).toBeGreaterThan(0);

    midiInputHub.setEnabled(true);
    await expect
      .element(tab("Video/Audio"))
      .toHaveAttribute("aria-selected", "true");
    await expect.poll(() => queryAll(MEDIA_PICKER).length).toBeGreaterThan(0);

    await tab("MIDI").click();
    await expect.poll(() => queryAll(MEDIA_PICKER).length).toBe(0);
    await expect
      .element(page.getByRole("radio", { name: "MIDI device" }))
      .toBeChecked();
    await expect
      .element(page.getByRole("combobox", { name: "Quantize" }))
      .toHaveTextContent("Off");

    midiInputHub.setEnabled(false);
    await expect.element(tab("MIDI")).not.toBeInTheDocument();
    await expect.poll(() => queryAll(MEDIA_PICKER).length).toBeGreaterThan(0);
  },
  TEST_TIMEOUT,
);

test(
  "a track armed for MIDI records a device's notes live, with no media prompt",
  async () => {
    await openEditor();
    await chooseMidiTab();
    await armButton().click();
    // Neither arming nor pressing play asks for the camera or mic.
    await page.getByRole("button", { name: "Play timeline" }).click();
    await nextFrame();
    expect(getUserMedia).not.toHaveBeenCalled();
    await expect.element(recordButton()).toBeEnabled();
    await recordButton().click();
    await expect.element(stopButton()).toBeVisible();
    await expect.poll(() => port.onmidimessage).not.toBeNull();

    send(NOTE_ON, 60, 100);
    await expect.poll(() => queryAll(LIVE_NOTES).length).toBe(1);
    send(NOTE_OFF, 60, 0);
    send(NOTE_ON, 67, 90);
    await expect.poll(() => queryAll(LIVE_NOTES).length).toBe(2);

    // The key still down when recording stops makes it into the clip.
    await stopButton().click();
    await expect.poll(() => queryAll(CLIP_NOTES).length).toBe(2);
    expect(queryAll("[data-live-recording-track-id]")).toHaveLength(0);
    expect(getUserMedia).not.toHaveBeenCalled();
  },
  TEST_TIMEOUT,
);

test(
  "the computer keyboard records too, and quantize puts its notes on the grid",
  async () => {
    await openEditor();
    await chooseMidiTab();
    await page.getByRole("radio", { name: "Computer keyboard" }).click();
    await page.getByRole("combobox", { name: "Quantize" }).click();
    await page.getByRole("option", { name: "1/4", exact: true }).click();
    await armButton().click();
    await recordButton().click();
    await expect.element(stopButton()).toBeVisible();
    // Well clear of the first grid line, so only quantize lands it on one.
    await new Promise((resolve) => setTimeout(resolve, 330));

    await userEvent.keyboard("{a>}");
    await expect.poll(() => queryAll(LIVE_NOTES).length).toBe(1);
    await userEvent.keyboard("{/a}");
    await stopButton().click();

    await expect.poll(() => queryAll(CLIP_NOTES).length).toBe(1);
    await userEvent.click(query("[data-source-span-id]"));
    await expect.poll(() => queryAll(".piano-roll__note").length).toBe(1);
    const label = queryAll(".piano-roll__note")[0]?.getAttribute("aria-label");
    const beat = Number(label?.match(/at beat (.+)$/)?.[1]);
    expect(Number.isInteger(beat)).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
  },
  TEST_TIMEOUT,
);

test(
  "a take on a track with no instrument is silent, and its clip's Synth then sounds with nothing selected",
  async () => {
    const createOscillator = vi.spyOn(
      AudioContext.prototype,
      "createOscillator",
    );
    onTestFinished(() => createOscillator.mockRestore());
    await openEditor();
    await chooseMidiTab();
    await page.getByRole("radio", { name: "Computer keyboard" }).click();
    await armButton().click();
    await recordButton().click();
    await expect.element(stopButton()).toBeVisible();
    await userEvent.keyboard("{a>}");
    await expect.poll(() => queryAll(LIVE_NOTES).length).toBe(1);
    await userEvent.keyboard("{/a}");
    expect(createOscillator).not.toHaveBeenCalled();
    await stopButton().click();
    await expect.poll(() => queryAll(CLIP_NOTES).length).toBe(1);
    expect(queryAll(".piano-roll__note")).toHaveLength(0);

    await userEvent.keyboard("{a>}");
    await expect.poll(() => createOscillator.mock.calls.length).toBe(1);
    await userEvent.keyboard("{/a}");
    expect(queryAll(CLIP_NOTES)).toHaveLength(1);
  },
  TEST_TIMEOUT,
);

test(
  "stopping with nothing played leaves no clip",
  async () => {
    await openEditor();
    await chooseMidiTab();
    await armButton().click();
    await recordButton().click();
    await stopButton().click();
    await expect.element(recordButton()).toBeVisible();
    expect(queryAll("[data-source-span-id]")).toHaveLength(0);
    expect(getUserMedia).not.toHaveBeenCalled();
  },
  TEST_TIMEOUT,
);

test(
  "with MIDI off an armed track still records from its camera and mic",
  async () => {
    await openEditor();
    await armButton().click();
    await recordButton().click();
    await expect.poll(() => getUserMedia.mock.calls.length).toBeGreaterThan(0);
  },
  TEST_TIMEOUT,
);
