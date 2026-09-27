import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import {
  type AlsDocument,
  decodeLayersState,
  decodeTimeSignature,
  decodeZvidCaptureAuBuffer,
  decodeZvidCaptureState,
  parseAls,
  parseAlsXml,
  type ZvidCaptureState,
} from "./parse.ts";
import { parseXml } from "./xml.ts";

const fixture = readFileSync(
  new URL("../../../test/fixtures/als/dogfood3.als", import.meta.url),
);

function hex(text: string): string {
  return Buffer.from(text, "utf8").toString("hex").toUpperCase();
}

describe("parseAls with dogfood3.als", () => {
  let doc: AlsDocument;
  before(async () => {
    doc = await parseAls(new Uint8Array(fixture));
  });

  const track = (id: number) => {
    const found = doc.tracks.find((candidate) => candidate.id === id);
    assert.ok(found, `missing track ${id}`);
    return found;
  };

  it("reads the Live version", () => {
    assert.equal(doc.creator, "Ableton Live 11.3.13");
    assert.equal(doc.minorVersion, "11.0_11300");
  });

  it("reads tempo, time signature and transport loop", () => {
    assert.equal(doc.tempo, 126.404495);
    assert.deepEqual(doc.tempoAutomation, [
      { time: -63072000, bpm: 126.404495 },
    ]);
    assert.deepEqual(doc.timeSignature, { numerator: 4, denominator: 4 });
    assert.deepEqual(doc.transport, {
      currentTime: 22.25,
      loopOn: true,
      loopStart: 0,
      loopLength: 22.25,
    });
  });

  it("lists every track with its kind and name", () => {
    assert.deepEqual(
      doc.tracks.map(({ id, kind }) => [id, kind]),
      [
        [12, "midi"],
        [8, "audio"],
        [16, "audio"],
        [17, "audio"],
        [2, "return"],
        [3, "return"],
      ],
    );
    assert.equal(track(12).name, "1-Akustichord Kit");
    assert.equal(track(17).name, "4-Audio");
    assert.equal(track(12).groupId, null);
  });

  it("decodes Layers recordings on video tracks", () => {
    for (const id of [12, 8, 16]) {
      assert.equal(track(id).isVideoTrack, true, `track ${id}`);
      assert.equal(track(id).layers?.version, "1");
      assert.ok(track(id).layers?.recordings.length, `track ${id}`);
    }
    assert.deepEqual(track(8).layers?.recordings, [
      {
        filename: "video-12-13-23-20-13-46-0.mp4",
        dimensions: [1080, 1920],
        fps: [30, 1],
        frameStart: 0,
      },
      {
        filename: "video-12-13-23-20-15-14-1.mp4",
        dimensions: [1080, 1920],
        fps: [30, 1],
        frameStart: 57,
      },
    ]);
  });

  it("flags tracks without a Layers Record device", () => {
    assert.equal(track(17).isVideoTrack, false);
    assert.equal(track(17).layers, null);
  });

  it("reads arrangement clips but not take lanes or clip slots", () => {
    const clips = track(8).clips;
    assert.deepEqual(
      clips.map((clip) => [clip.id, clip.name]),
      [[6, "Audio 7"]],
    );
  });

  it("reads loop, warp and sample data for clip 8/6", () => {
    const clip = track(8).clips.find((candidate) => candidate.id === 6);
    assert.ok(clip);
    assert.equal(clip.kind, "audio");
    assert.equal(clip.time, 0);
    assert.equal(clip.currentStart, 0);
    assert.equal(clip.currentEnd, 22.25);
    assert.equal(clip.disabled, false);
    assert.deepEqual(clip.loop, {
      loopStart: 22,
      loopEnd: 44.25,
      startRelative: 0,
      loopOn: false,
      hiddenLoopStart: 22,
      hiddenLoopEnd: 44,
    });
    assert.equal(clip.isWarped, true);
    assert.equal(clip.warpMode, 0);
    assert.deepEqual(clip.warpMarkers, [
      { secTime: 0, beatTime: 0 },
      { secTime: 0.014833333232738354, beatTime: 0.03125 },
    ]);
    assert.deepEqual(clip.sample, {
      path: "C:/Users/Loren/Documents/Layers/dogfood3 Project/Samples/Recorded/2-Audio 0001 [2023-12-13 121346].wav",
      relativePath: "Samples/Recorded/2-Audio 0001 [2023-12-13 121346].wav",
      defaultDuration: 1096704,
      defaultSampleRate: 48000,
    });
  });

  it("reads MIDI clips without sample data", () => {
    const clips = track(12).clips;
    assert.ok(clips.length > 0);
    for (const clip of clips) {
      assert.equal(clip.kind, "midi");
      assert.equal(clip.sample, null);
    }
  });
});

describe("parseAlsXml", () => {
  const liveSet = (mainTrack: string, tracks = "") => `<?xml version="1.0"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12049" Creator="Ableton Live 12.0.5">
  <LiveSet>
    <Tracks>${tracks}</Tracks>
    ${mainTrack}
    <Transport><LoopOn Value="false" /><LoopStart Value="8" /><LoopLength Value="16" /><CurrentTime Value="4" /></Transport>
  </LiveSet>
</Ableton>`;
  const mainTrack = (name: string) => `<${name}>
    <AutomationEnvelopes><Envelopes>
      <AutomationEnvelope Id="0">
        <EnvelopeTarget><PointeeId Value="8" /></EnvelopeTarget>
        <Automation><Events>
          <FloatEvent Id="1" Time="-63072000" Value="120" />
          <FloatEvent Id="2" Time="16" Value="90" />
        </Events></Automation>
      </AutomationEnvelope>
    </Envelopes></AutomationEnvelopes>
    <DeviceChain><Mixer>
      <Tempo><Manual Value="120" /><AutomationTarget Id="8" /></Tempo>
      <TimeSignature><Manual Value="200" /><AutomationTarget Id="10" /></TimeSignature>
    </Mixer></DeviceChain>
  </${name}>`;

  it("accepts Live 12's MainTrack and reads tempo automation", () => {
    const doc = parseAlsXml(liveSet(mainTrack("MainTrack")));
    assert.equal(doc.tempo, 120);
    assert.deepEqual(doc.tempoAutomation, [
      { time: -63072000, bpm: 120 },
      { time: 16, bpm: 90 },
    ]);
    assert.deepEqual(doc.timeSignature, { numerator: 3, denominator: 4 });
  });

  it("reads group membership and group tracks", () => {
    const doc = parseAlsXml(
      liveSet(
        mainTrack("MasterTrack"),
        `<GroupTrack Id="4"><Name><EffectiveName Value="Group" /></Name><TrackGroupId Value="-1" /></GroupTrack>
         <AudioTrack Id="5"><Name><EffectiveName Value="In &amp; Out" /></Name><TrackGroupId Value="4" /></AudioTrack>`,
      ),
    );
    assert.deepEqual(
      doc.tracks.map(({ id, kind, name, groupId, clips, isVideoTrack }) => ({
        id,
        kind,
        name,
        groupId,
        clips,
        isVideoTrack,
      })),
      [
        {
          id: 4,
          kind: "group",
          name: "Group",
          groupId: null,
          clips: [],
          isVideoTrack: false,
        },
        {
          id: 5,
          kind: "audio",
          name: "In & Out",
          groupId: 4,
          clips: [],
          isVideoTrack: false,
        },
      ],
    );
  });

  it("rejects documents that are not Live sets", () => {
    assert.throws(() => parseAlsXml("<Other />"), /Not an Ableton Live set/);
  });
});

describe("parseAls time signatures saved by Live 12", () => {
  // Live leaves the main track's `Manual` at 201 (4/4) in all of these; the
  // signature is only in the TimeSignature envelope's initial event.
  for (const [name, numerator, denominator] of [
    ["time-signature-3-4.als", 3, 4],
    ["time-signature-6-8.als", 6, 8],
    ["time-signature-7-8.als", 7, 8],
  ] as const) {
    it(`reads ${numerator}/${denominator} from ${name}`, async () => {
      const bytes = readFileSync(
        new URL(`../../../test/fixtures/als/${name}`, import.meta.url),
      );
      const doc = await parseAls(new Uint8Array(bytes));
      assert.equal(doc.creator, "Ableton Live 12.0.25");
      assert.deepEqual(doc.timeSignature, { numerator, denominator });
    });
  }
});

describe("parseAls input handling", () => {
  it("accepts uncompressed XML", async () => {
    const xml = `<Ableton><LiveSet><Tracks /><MasterTrack /></LiveSet></Ableton>`;
    const doc = await parseAls(new TextEncoder().encode(xml));
    assert.deepEqual(doc.tracks, []);
  });
});

describe("decodeTimeSignature", () => {
  it("decodes Live's packed numerator and denominator", () => {
    assert.deepEqual(decodeTimeSignature(201), {
      numerator: 4,
      denominator: 4,
    });
    assert.deepEqual(decodeTimeSignature(200), {
      numerator: 3,
      denominator: 4,
    });
    assert.deepEqual(decodeTimeSignature(302), {
      numerator: 6,
      denominator: 8,
    });
    assert.deepEqual(decodeTimeSignature(99 + 6), {
      numerator: 7,
      denominator: 2,
    });
  });
});

describe("decodeLayersState", () => {
  it("decodes whitespace-wrapped hex JSON", () => {
    const encoded = hex(
      '{"recordings":[{"dimensions":[1920,1080],"filename":"a.mp4","fps":[30000,1001],"frameStart":3}],"version":"1"}',
    );
    const wrapped = `\n  ${encoded.slice(0, 20)}\n  ${encoded.slice(20)}\n`;
    assert.deepEqual(decodeLayersState(wrapped), {
      version: "1",
      recordings: [
        {
          filename: "a.mp4",
          dimensions: [1920, 1080],
          fps: [30000, 1001],
          frameStart: 3,
        },
      ],
    });
  });

  it("decodes ZVID Capture state from the shared /daw fixture", () => {
    const fixtureHex = readFileSync(
      new URL(
        "../../../../daw/fixtures/state/zvid-capture-v1.hex",
        import.meta.url,
      ),
      "utf8",
    );
    assert.deepEqual(decodeLayersState(fixtureHex), {
      version: "1",
      recordings: [
        {
          filename: "video-01-9-25-20-36-12-0.mp4",
          dimensions: [1920, 1080],
          fps: [30, 1],
          frameStart: 915,
        },
        {
          filename: "video-02-9-25-20-41-03-0.mp4",
          dimensions: [1280, 720],
          fps: [30000, 1001],
          frameStart: 0,
        },
      ],
    });
  });

  it("rejects malformed hex", () => {
    assert.throws(() => decodeLayersState("ABC"), /not valid hex/);
    assert.throws(() => decodeLayersState("ZZ"), /not valid hex/);
  });
});

describe("parseXml", () => {
  it("reads attributes, text and nesting", () => {
    const root = parseXml(
      `<?xml version="1.0"?><!-- note --><A x="1" y='&lt;2&gt;'><B/> text &#65;&#x42; <C z="&quot;"></C></A>`,
    );
    assert.equal(root.name, "A");
    assert.deepEqual(root.attributes, { x: "1", y: "<2>" });
    assert.deepEqual(
      root.children.map((element) => element.name),
      ["B", "C"],
    );
    assert.equal(root.text, "text AB");
    assert.equal(root.children[1].attributes.z, '"');
  });

  it("rejects mismatched tags", () => {
    assert.throws(() => parseXml("<A><B></A>"), /Unexpected <\/A>/);
    assert.throws(() => parseXml("<A>"), /Unclosed <A>/);
  });
});

describe("parseAls with ZVID Capture fixtures", () => {
  const load = (name: string) =>
    parseAls(
      new Uint8Array(
        readFileSync(
          new URL(`../../../test/fixtures/als/${name}`, import.meta.url),
        ),
      ),
    );

  it("reads every VST3 take, including unanchored ones", async () => {
    const [track] = (await load("zvid-capture-vst3.xml")).tracks;
    assert.equal(track.isVideoTrack, true);
    assert.equal(track.captureDevice, "zvid-capture");
    const state = track.layers as ZvidCaptureState;
    assert.equal(state.version, "1");
    assert.equal(state.recordRoot, "project");
    assert.deepEqual(state.recordings[1], {
      filename: "video-01-9-25-20-36-12-0.mp4",
      dimensions: [1920, 1080],
      fps: [30, 1],
      frameStart: -120,
      fileOffsetSec: 20,
      transportStartSec: 16,
      transportStartBeats: 32,
      durationSec: 8,
      createdAt: "2026-09-25T20:36:30Z",
    });
    assert.equal(state.recordings[2].transportStartSec, null);
    assert.equal(state.recordings[2].transportStartBeats, null);
  });

  it("reads each take's own record root", () => {
    const state = decodeZvidCaptureState(
      new TextEncoder().encode(
        JSON.stringify({
          version: "1",
          recordRoot: "project",
          recordings: [
            { filename: "old.mp4" },
            { filename: "docs.mp4", recordRoot: "documents" },
            { filename: "set.mp4", recordRoot: "project" },
            { filename: "odd.mp4", recordRoot: "elsewhere" },
          ],
        }),
      ),
    );
    assert.equal(state.recordRoot, "project");
    assert.deepEqual(
      state.recordings.map((take) => take.recordRoot),
      [undefined, "documents", "project", undefined],
    );
    assert.equal("recordRoot" in state.recordings[0], false);
  });

  it("reads AU state from the zvid-state key of the Buffer plist", async () => {
    const [track] = (await load("zvid-capture-au.xml")).tracks;
    assert.equal(track.captureDevice, "zvid-capture");
    const state = track.layers as ZvidCaptureState;
    assert.equal(state.recordRoot, "documents");
    assert.deepEqual(
      state.recordings.map(({ filename, transportStartSec, createdAt }) => [
        filename,
        transportStartSec,
        createdAt,
      ]),
      [
        ["video-01-9-25-21-00-00-0.mp4", 0, "2026-09-25T21:00:00Z"],
        ["video-02-9-25-21-05-00-0.mp4", 2, "2026-09-25T21:05:00Z"],
        ["video-03-9-25-21-09-00-0.mp4", null, "2026-09-25T21:09:00Z"],
      ],
    );
  });

  it("reads Layers Record and ZVID Capture tracks in the same set", async () => {
    const doc = await load("layers-and-zvid-capture.xml");
    assert.deepEqual(
      doc.tracks.map(({ id, captureDevice, isVideoTrack }) => [
        id,
        captureDevice,
        isVideoTrack,
      ]),
      [
        [8, "layers-record", true],
        [20, "zvid-capture", true],
      ],
    );
    assert.deepEqual(doc.tracks[0].layers, {
      version: "1",
      recordings: [
        {
          filename: "video-12-13-23-20-13-46-0.mp4",
          dimensions: [1080, 1920],
          fps: [30, 1],
          frameStart: 0,
        },
        {
          filename: "video-12-13-23-20-15-14-1.mp4",
          dimensions: [1080, 1920],
          fps: [30, 1],
          frameStart: 57,
        },
      ],
    });
  });

  it("marks tracks without a capture device", async () => {
    const doc = parseAlsXml(`<Ableton><LiveSet><Tracks>
      <AudioTrack Id="1"><DeviceChain><DeviceChain><Devices>
        <PluginDevice Id="0"><PluginDesc><Vst3PluginInfo Id="0">
          <Name Value="Some Reverb" />
        </Vst3PluginInfo></PluginDesc></PluginDevice>
        <AuPluginDevice Id="1"><PluginDesc><AuPluginInfo Id="0">
          <Name Value="Layers Record" />
        </AuPluginInfo></PluginDesc></AuPluginDevice>
      </Devices></DeviceChain></DeviceChain></AudioTrack>
    </Tracks><MainTrack /></LiveSet></Ableton>`);
    const [track] = doc.tracks;
    assert.equal(track.isVideoTrack, false);
    assert.equal(track.captureDevice, null);
    assert.equal(track.layers, null);
  });
});

describe("decodeZvidCaptureAuBuffer", () => {
  const json = JSON.stringify({
    version: "1",
    recordRoot: "project",
    recordings: [
      {
        filename: "video-01-9-25-20-36-12-0.mp4",
        dimensions: [1920, 1080],
        fps: [30, 1],
        frameStart: -45,
        fileOffsetSec: 1.5,
        transportStartSec: 0,
        transportStartBeats: 0,
        durationSec: 8,
        createdAt: "2026-09-25T20:36:12Z",
      },
    ],
  });

  // A minimal `bplist00` encoder: one dict of ASCII keys to string or data.
  function binaryPlist(entries: Array<[string, string | Uint8Array]>) {
    const objects: Uint8Array[] = [];
    const marker = (type: number, length: number) =>
      length < 15
        ? [(type << 4) | length]
        : [(type << 4) | 15, 0x11, length >> 8, length & 0xff];
    const add = (bytes: number[] | Uint8Array) =>
      objects.push(Uint8Array.from(bytes)) - 1;
    const ascii = (value: string) =>
      add([...marker(5, value.length), ...Buffer.from(value, "latin1")]);
    const keys = entries.map(([key]) => ascii(key));
    const values = entries.map(([, value]) =>
      typeof value === "string"
        ? ascii(value)
        : add([...marker(4, value.length), ...value]),
    );
    const top = add([...marker(13, entries.length), ...keys, ...values]);
    const header = Buffer.from("bplist00", "latin1");
    const offsets: number[] = [];
    let length = header.length;
    for (const object of objects) {
      offsets.push(length);
      length += object.length;
    }
    const trailer = new Uint8Array(32);
    const view = new DataView(trailer.buffer);
    trailer[6] = 2;
    trailer[7] = 1;
    view.setBigUint64(8, BigInt(objects.length));
    view.setBigUint64(16, BigInt(top));
    view.setBigUint64(24, BigInt(length));
    const table = new Uint8Array(offsets.length * 2);
    offsets.forEach((offset, index) => {
      new DataView(table.buffer).setUint16(index * 2, offset);
    });
    return Buffer.concat([header, ...objects, table, trailer]);
  }

  it("reads the zvid-state data of a binary plist", () => {
    const plist = binaryPlist([
      ["name", "Untitled"],
      ["zvid-state", Buffer.from(json, "utf8")],
    ]);
    const state = decodeZvidCaptureAuBuffer(plist.toString("hex"));
    assert.equal(state.recordRoot, "project");
    assert.equal(state.recordings[0].frameStart, -45);
    assert.equal(state.recordings[0].fileOffsetSec, 1.5);
  });

  it("rejects a plist without zvid-state", () => {
    const plist = `<?xml version="1.0"?><plist version="1.0"><dict><key>name</key><string>x</string></dict></plist>`;
    assert.throws(
      () => decodeZvidCaptureAuBuffer(hex(plist)),
      /no "zvid-state" key/,
    );
  });
});
