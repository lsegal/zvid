import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildStatusItems } from "./status-bar/registry.ts";
import {
  formatStatusAudio,
  formatStatusPlayhead,
  type StatusItemsState,
} from "./status-items.ts";
import { formatMusicalPosition, formatTimecode } from "./timeline-format.ts";

const FOUR_FOUR = { numerator: 4, denominator: 4 };
const SHA = "c94f40e9151d40b4dd87bd2072993522791ff2d4";
const BUILD = {
  version: "1.2.3",
  commit: SHA,
  buildTime: "2026-09-24T14:45:12.345Z",
};

const BASE: StatusItemsState = {
  version: BUILD,
  sessionName: "Demo reel",
  timelineMode: "musical",
  // At 120 BPM one quarter is half a second.
  bpm: 120,
  playheadQ: 0,
  signature: FOUR_FOUR,
  fps: 30,
  canvasWidth: 1920,
  canvasHeight: 1080,
  audio: { sampleRate: 48000, channels: 2, hasAudio: true },
  collaboration: { mode: "idle", connected: false, peerCount: 0 },
  clipCount: 3,
  trackCount: 2,
  offlineCount: 0,
};

function itemsById(state: StatusItemsState) {
  return new Map(buildStatusItems(state).map((item) => [item.id, item]));
}

describe("formatMusicalPosition", () => {
  it("counts bars, beats and sixteenths from 1", () => {
    assert.equal(formatMusicalPosition(0, FOUR_FOUR), "1.1.1");
    assert.equal(formatMusicalPosition(5.25, FOUR_FOUR), "2.2.2");
  });

  it("uses the signature's beat unit", () => {
    assert.equal(
      formatMusicalPosition(3, { numerator: 6, denominator: 8 }),
      "2.1.1",
    );
  });

  it("clamps negative positions to the start", () => {
    assert.equal(formatMusicalPosition(-2, FOUR_FOUR), "1.1.1");
  });
});

describe("formatTimecode", () => {
  it("formats minutes, seconds and frames", () => {
    assert.equal(formatTimecode(72.5, 30), "01:12:15");
    assert.equal(formatTimecode(0.5, 24), "00:00:12");
  });
});

describe("formatStatusPlayhead", () => {
  it("shows bars.beats on the tempo ruler", () => {
    assert.equal(formatStatusPlayhead({ ...BASE, playheadQ: 5.25 }), "2.2.2");
  });

  it("shows timecode on the SMPTE ruler", () => {
    assert.equal(
      formatStatusPlayhead({
        ...BASE,
        timelineMode: "timecode",
        playheadQ: 145,
      }),
      "01:12:15",
    );
  });
});

describe("formatStatusAudio", () => {
  it("shows the sample rate and channels", () => {
    assert.equal(formatStatusAudio({ sampleRate: 44100 }), "44100 Hz / 2 ch");
    assert.equal(
      formatStatusAudio({ sampleRate: 48000, channels: 6 }),
      "48000 Hz / 6 ch",
    );
  });

  it("falls back to Embedded or None", () => {
    assert.equal(formatStatusAudio({ hasAudio: true }), "Embedded");
    assert.equal(formatStatusAudio({ hasAudio: false }), "None");
    assert.equal(formatStatusAudio(null), "None");
  });
});

describe("buildStatusItems", () => {
  it("lists version, session, timeline, resolution and audio in order", () => {
    assert.deepEqual(
      buildStatusItems(BASE).map((item) => item.id),
      [
        "version",
        "session",
        "timeline",
        "playhead",
        "resolution",
        "audio",
        "content",
      ],
    );
  });

  it("keeps values short and puts the full text in the title", () => {
    assert.deepEqual(buildStatusItems(BASE), [
      {
        id: "version",
        label: "zvid",
        value: "1.2.3+c94f40e",
        title: `zvid 1.2.3+c94f40e\nCommit ${SHA}\nBuilt 2026-09-24 14:45 UTC`,
      },
      {
        id: "session",
        label: "Session",
        value: "Demo reel",
        title: "Session: Demo reel",
      },
      {
        id: "timeline",
        label: "Tempo",
        value: "120 BPM",
        title: "Timeline: Tempo ruler, 120 BPM",
      },
      {
        id: "playhead",
        label: "Pos",
        value: "1.1.1",
        title: "Playhead: 1.1.1 (bar.beat.sixteenth)",
      },
      {
        id: "resolution",
        label: "Res",
        value: "1920x1080",
        title: "Resolution: 1920 x 1080",
      },
      {
        id: "audio",
        label: "Audio",
        value: "48000 Hz / 2 ch",
        title: "Audio: 48000 Hz / 2 ch",
      },
      {
        id: "content",
        label: "Clips",
        value: "3 / 2",
        title: "3 clips on 2 tracks",
      },
    ]);
  });

  it("names an unnamed session Untitled session", () => {
    assert.equal(
      itemsById({ ...BASE, sessionName: null }).get("session")?.value,
      "Untitled session",
    );
  });

  it("shows the bare version when the build has no commit", () => {
    const version = itemsById({
      ...BASE,
      version: { ...BUILD, commit: "dev" },
    }).get("version");
    assert.equal(version?.value, "1.2.3");
    assert.equal(version?.title, "zvid 1.2.3\nBuilt 2026-09-24 14:45 UTC");
  });

  it("leaves the version out until one is known", () => {
    assert.equal(itemsById({ ...BASE, version: null }).has("version"), false);
  });

  it("switches the timeline and playhead to SMPTE", () => {
    const items = itemsById({
      ...BASE,
      timelineMode: "timecode",
      bpm: 92.456,
      playheadQ: 0,
    });
    assert.equal(items.get("timeline")?.label, "SMPTE");
    assert.equal(items.get("timeline")?.value, "92.46 BPM");
    assert.equal(items.get("playhead")?.value, "00:00:00");
    assert.equal(
      items.get("playhead")?.title,
      "Playhead: 00:00:00 (minutes:seconds:frames at 30 fps)",
    );
  });

  it("shows collaboration only while it is active", () => {
    assert.equal(itemsById(BASE).has("collaboration"), false);

    const collaboration = (
      mode: StatusItemsState["collaboration"]["mode"],
      connected: boolean,
      peerCount: number,
    ) =>
      itemsById({ ...BASE, collaboration: { mode, connected, peerCount } }).get(
        "collaboration",
      );

    assert.equal(collaboration("sharing", false, 0)?.value, "Connecting…");
    assert.equal(collaboration("sharing", true, 0)?.value, "Sharing · waiting");
    assert.equal(
      collaboration("sharing", true, 0)?.title,
      "Collaboration: sharing this session, waiting for a peer",
    );
    assert.equal(collaboration("sharing", true, 2)?.value, "Sharing · 2 peers");
    assert.equal(collaboration("connected", true, 1)?.value, "Joined · 1 peer");
    assert.equal(
      collaboration("connected", true, 0)?.title,
      "Collaboration: joined, waiting for the host",
    );
  });

  it("reports offline media only when some is missing", () => {
    assert.equal(itemsById(BASE).has("media"), false);
    const media = itemsById({ ...BASE, offlineCount: 1 }).get("media");
    assert.equal(media?.value, "1 offline");
    assert.equal(media?.title, "1 media file offline");
  });

  it("pluralizes clip and track counts in the title", () => {
    assert.equal(
      itemsById({ ...BASE, clipCount: 1, trackCount: 1 }).get("content")?.title,
      "1 clip on 1 track",
    );
  });
});
