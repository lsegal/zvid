import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { DesktopShell } from "../../component-test/shells.tsx";
import { useMediaDrawer } from "../../hooks/useMediaDrawer.ts";
import type { SessionLibraryState } from "../../hooks/useSessionLibrary.ts";
import { createPlayheadSignal } from "../../playhead-signal.ts";
import {
  RECORD_INPUT_STORAGE_KEYS,
  RECORD_TRACK_INPUTS_STORAGE_KEY,
} from "../../recording/record-inputs.ts";
import { TimelineToolbar } from "../timeline/TimelineToolbar";
import { MediaDrawer } from "./MediaDrawer";
import { MEDIA_DRAWER_STORAGE_KEY } from "./media-drawer-model.ts";

// The Media drawer's Record tab picks the default camera and mic to record
// from, with a live camera preview and an input meter, opened from the
// timeline toolbar's Media | Record switch. Stand-in devices play a canvas
// for the camera and an oscillator for the mic, as Chromium's fake devices
// do in the e2e specs. Ported from e2e/record-tab.spec.ts, which keeps the
// drawer and the inputs across a reload, and from the preview half of
// e2e/record-default-input.spec.ts, which keeps recording.
const noop = () => {};
const TIME_FORMAT = {
  timelineMode: "timecode",
  bpm: 120,
  signature: { numerator: 4, denominator: 4 },
  fps: 30,
} as const;

// The toolbar and the editor grid's drawer column, as App lays them out.
function Editor() {
  const drawer = useMediaDrawer({ editorGridWidth: window.innerWidth });
  return (
    <DesktopShell>
      <TimelineToolbar
        bpm={120}
        commitProjectChange={noop}
        commitProjectPatch={noop}
        fps={30}
        isMediaDrawerOpen={drawer.isOpen}
        isPlaying={false}
        isRecording={false}
        mediaDrawerTab={drawer.tab}
        onSelectMediaDrawerTab={drawer.selectTab}
        playheadSignal={createPlayheadSignal()}
        signature={{ numerator: 4, denominator: 4 }}
        signatureId="4/4"
        snapEnabled={false}
        timelineMode="timecode"
      />
      <div className="editor-grid" style={{ height: 600 }}>
        <MediaDrawer
          drawer={drawer}
          // Only the Sessions tab reads the library.
          library={{} as SessionLibraryState}
          mediaItems={[]}
          onBackfillMediaDetails={noop}
          onImport={noop}
          onOpenMedia={noop}
          prefersReducedMotion={false}
          remoteMediaProgress={new Map()}
          timeFormat={TIME_FORMAT}
        />
        <div data-testid="timeline" />
      </div>
    </DesktopShell>
  );
}

// The stand-in devices. The browser names them and lists their IDs only
// once a stream is granted; the "default" alias names the second mic, the
// one the system routes to.
const DEVICES: MediaDeviceInfo[] = [
  { deviceId: "camera-1", groupId: "camera", label: "fake_device_0" },
  { deviceId: "default", groupId: "usb", label: "Default - USB Mic" },
  { deviceId: "mic-built-in", groupId: "built-in", label: "Built-in Mic" },
  { deviceId: "mic-usb", groupId: "usb", label: "USB Mic" },
].map(
  (device) =>
    ({
      ...device,
      kind: device.groupId === "camera" ? "videoinput" : "audioinput",
      toJSON: () => device,
    }) as MediaDeviceInfo,
);

type FakeMedia = {
  // Every getUserMedia call's constraints.
  requests: MediaStreamConstraints[];
  // Rejects every request as the user refusing access.
  deny: boolean;
  granted: boolean;
  cleanups: (() => void)[];
};

let media: FakeMedia;

function cameraTrack() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 48;
  const context = canvas.getContext("2d");
  const draw = () => {
    if (context) {
      context.fillStyle = "#0a0";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
  };
  draw();
  const interval = window.setInterval(draw, 50);
  media.cleanups.push(() => window.clearInterval(interval));
  return canvas.captureStream(20).getVideoTracks()[0];
}

function microphoneTrack() {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const destination = context.createMediaStreamDestination();
  oscillator.connect(destination);
  oscillator.start();
  media.cleanups.push(() => void context.close());
  return destination.stream.getAudioTracks()[0];
}

beforeEach(async () => {
  for (const key of [
    MEDIA_DRAWER_STORAGE_KEY,
    RECORD_TRACK_INPUTS_STORAGE_KEY,
    ...Object.values(RECORD_INPUT_STORAGE_KEYS),
  ]) {
    window.localStorage.removeItem(key);
  }
  // The mic's AudioContext and the meter's need a user activation.
  await userEvent.click(document.body);
  media = { requests: [], deny: false, granted: false, cleanups: [] };
  const devices = navigator.mediaDevices;
  devices.getUserMedia = async (constraints = {}) => {
    media.requests.push(constraints);
    if (media.deny) {
      throw new DOMException("Permission denied", "NotAllowedError");
    }
    media.granted = true;
    const tracks = [
      ...(constraints.video ? [cameraTrack()] : []),
      ...(constraints.audio ? [microphoneTrack()] : []),
    ];
    return new MediaStream(tracks);
  };
  devices.enumerateDevices = async () =>
    media.granted
      ? DEVICES
      : (["videoinput", "audioinput"] as const).map(
          (kind) =>
            ({ deviceId: "", groupId: "", kind, label: "" }) as MediaDeviceInfo,
        );
});

afterEach(() => {
  const devices = navigator.mediaDevices as Partial<MediaDevices>;
  delete devices.getUserMedia;
  delete devices.enumerateDevices;
  for (const cleanup of media.cleanups) {
    cleanup();
  }
});

function drawer() {
  return page.getByRole("complementary", { name: "Media" });
}

// The toolbar's Media | Record switch above the timeline.
function segment(name: "Media" | "Record") {
  return page
    .getByRole("group", { name: "Media drawer" })
    .getByRole("button", { name, exact: true });
}

async function openDrawer() {
  await page.getByRole("button", { name: "Media", exact: true }).click();
  await expect.element(drawer()).toBeVisible();
}

// A locator's text, polled since the locator may not match yet.
function textOf(locator: { query: () => Element | null }) {
  return () => locator.query()?.textContent ?? null;
}

function combobox(input: "Video" | "Audio") {
  return drawer().getByRole("combobox", { name: `${input} input` });
}

async function pick(input: "Video" | "Audio", option: string) {
  await combobox(input).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

function cameraPreview() {
  return document.querySelector<HTMLVideoElement>(
    'video[aria-label="Camera preview"]',
  );
}

function leftLevel() {
  return Number(
    document
      .querySelector(
        '.record-input-picker__audio [role="meter"][aria-label="Left level"]',
      )
      ?.getAttribute("aria-valuenow"),
  );
}

// The audio device the last request that asked for one named: its exact
// ID, or true when the browser chooses.
function lastAudioRequest() {
  const audio = media.requests.findLast((request) => request.audio)?.audio;
  return typeof audio === "object"
    ? (audio.deviceId as { exact: string } | undefined)?.exact
    : audio;
}

test("the Record tab previews the default inputs", { timeout: 60_000 }, async () => {
  const start = performance.now();
  const log = (step: string) => console.log(step, Math.round(performance.now() - start));
  log("s2");
  await render(<Editor />);
  log("s3");
  await openDrawer();
  log("s4");
  await expect.element(segment("Media")).toHaveAttribute("aria-expanded", "true");
  log("s5");
  expect(media.requests).toHaveLength(0);
  log("s6");

  await segment("Record").click();
  log("s7");
  await expect
    .element(drawer().getByRole("heading", { name: "Record" }))
    .toBeVisible();
  log("s8");
  await expect
    .element(drawer().getByText("Configure your record inputs"))
    .toBeVisible();
  log("s9");
  expect(drawer().getByRole("button", { name: "List" }).elements()).toHaveLength(
    0,
  );
  log("s10");

  // The camera plays in the preview and the mic moves the meter.
  await expect.poll(() => cameraPreview()?.videoWidth ?? 0).toBeGreaterThan(0);
  log("s11");
  await expect.poll(leftLevel).toBeGreaterThan(-60);
  log("s12");
  expect(media.requests.length).toBeGreaterThan(0);
  log("s13");

  // Once access is granted the dropdown lists the cameras by name.
  await pick("Video", "fake_device_0");
  log("s14");
  await expect.poll(textOf(combobox("Video"))).toBe("fake_device_0");
  log("s15");
  await pick("Audio", "None");
  log("s16");
  await expect
    .element(
      drawer().getByRole("status").filter({ hasText: "No audio" }),
    )
    .toBeVisible();
  log("s17");
  await pick("Video", "None");
  log("s18");
  await expect
    .poll(
      () =>
        document.querySelector('.record-input-picker__video [role="status"]')
          ?.textContent,
    )
    .toBe("No video");
  log("s19");
  await expect.poll(() => cameraPreview()?.srcObject).toBeNull();
  log("s20");

  // Closing the drawer releases the camera.
  await pick("Video", "fake_device_0");
  log("s21");
  await expect.poll(() => cameraPreview()?.videoWidth ?? 0).toBeGreaterThan(0);
  log("s22");
  await drawer().getByRole("button", { name: "Close media drawer" }).click();
  log("s23");
  await expect
    .poll(() => document.querySelectorAll(".record-input-picker").length)
    .toBe(0);
  log("s24");
});

test("a saved camera that is gone falls back to the system default", async () => {
  window.localStorage.setItem(
    RECORD_INPUT_STORAGE_KEYS.video,
    JSON.stringify("gone"),
  );
  window.localStorage.setItem(RECORD_INPUT_STORAGE_KEYS.audio, "null");
  await render(<Editor />);
  await openDrawer();
  await segment("Record").click();
  await expect.poll(textOf(combobox("Video"))).toMatch(/^System default/);
  await expect.poll(() => cameraPreview()?.videoWidth ?? 0).toBeGreaterThan(0);
});

test("denied camera access shows why and keeps None picked", async () => {
  media.deny = true;
  await render(<Editor />);
  await openDrawer();
  await segment("Record").click();
  await expect
    .poll(textOf(drawer().getByRole("alert").first()))
    .toMatch(/access was denied/);
  await expect.poll(textOf(combobox("Video"))).toBe("None");
  await expect.poll(textOf(combobox("Audio"))).toBe("None");
});

test("the toolbar's Media | Record switch opens, switches and closes the drawer", async () => {
  await render(<Editor />);
  await expect.element(drawer()).not.toBeInTheDocument();
  await expect
    .element(segment("Media"))
    .toHaveAttribute("aria-expanded", "false");
  await expect
    .element(segment("Record"))
    .toHaveAttribute("aria-expanded", "false");
  // The drawer has no tab switch of its own.
  expect(page.getByRole("tab", { name: "Record" }).elements()).toHaveLength(0);

  // Record opens the drawer on the Record tab and asks for the inputs.
  await segment("Record").click();
  await expect.element(drawer()).toBeVisible();
  await expect
    .element(drawer().getByRole("heading", { name: "Record" }))
    .toBeVisible();
  await expect.element(drawer().getByLabelText("Camera preview")).toBeVisible();
  await expect
    .element(segment("Record"))
    .toHaveAttribute("aria-expanded", "true");
  await expect.element(segment("Record")).toHaveClass(/is-active/);
  await expect
    .element(segment("Media"))
    .toHaveAttribute("aria-expanded", "false");

  // Media switches to the Media tab with its view switch and search.
  await segment("Media").click();
  await expect.element(drawer()).toBeVisible();
  await expect.element(drawer().getByText("No media yet")).toBeVisible();
  await expect
    .element(drawer().getByRole("button", { name: "List" }))
    .toBeVisible();
  await expect
    .element(drawer().getByRole("textbox", { name: "Search media" }))
    .toBeVisible();
  await expect.element(segment("Media")).toHaveAttribute("aria-expanded", "true");
  await expect
    .element(segment("Record"))
    .toHaveAttribute("aria-expanded", "false");

  // Clicking the active segment closes the drawer.
  await segment("Media").click();
  await expect.element(drawer()).not.toBeInTheDocument();
  await expect
    .poll(
      () =>
        getComputedStyle(document.getElementById("media-drawer") as Element)
          .visibility,
    )
    .toBe("hidden");
  await expect
    .element(segment("Media"))
    .toHaveAttribute("aria-expanded", "false");
});

test("the Record tab puts the close button on the title row", async () => {
  await render(<Editor />);
  await openDrawer();
  await segment("Record").click();

  const heading = drawer().getByRole("heading", { name: "Record" });
  const close = drawer().getByRole("button", { name: "Close media drawer" });
  await expect.element(heading).toBeVisible();
  expect(close.elements()).toHaveLength(1);
  const headingBox = heading.element().getBoundingClientRect();
  const closeBox = close.element().getBoundingClientRect();
  // Their vertical ranges overlap: one row, with nothing above the title.
  expect(closeBox.y).toBeLessThan(headingBox.y + headingBox.height);
  expect(headingBox.y).toBeLessThan(closeBox.y + closeBox.height);
  expect(closeBox.x).toBeGreaterThan(headingBox.x + headingBox.width);

  await close.click();
  await expect.element(drawer()).not.toBeInTheDocument();
  await expect
    .poll(
      () =>
        getComputedStyle(document.getElementById("media-drawer") as Element)
          .visibility,
    )
    .toBe("hidden");
});

test("System default previews the device the default names, by its ID", async () => {
  await render(<Editor />);
  await segment("Record").click();
  await expect.poll(textOf(combobox("Audio"))).toMatch(/^System default/);

  // Once the browser lists device IDs, the preview reopens on the device
  // the "default" alias names rather than leaving the choice to
  // getUserMedia.
  await expect.poll(lastAudioRequest).toBe("mic-usb");
  await expect.poll(leftLevel).toBeGreaterThan(-60);
});
