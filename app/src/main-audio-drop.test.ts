import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  getDroppedAudioFile,
  getMainAudioDragState,
  isAudioFile,
  isWithinMainAudioDropTarget,
  MAIN_AUDIO_DROP_TARGET_ATTRIBUTE,
} from "./main-audio-drop.ts";

const mainAudioRowTsx = readFileSync(
  new URL("./components/timeline/MainAudioRow.tsx", import.meta.url),
  "utf8",
);
const useSourceTrackDropTs = readFileSync(
  new URL("./hooks/useSourceTrackDrop.ts", import.meta.url),
  "utf8",
);
const useMainAudioTs = readFileSync(
  new URL("./hooks/useMainAudio.ts", import.meta.url),
  "utf8",
);

const tauriConf = JSON.parse(
  readFileSync(
    new URL("../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
);

const file = (name: string, type = "") => ({ name, type });

describe("isAudioFile", () => {
  it("accepts audio MIME types", () => {
    assert.equal(isAudioFile(file("mix", "audio/wav")), true);
    assert.equal(isAudioFile(file("mix", "audio/mpeg")), true);
  });

  it("rejects non-audio MIME types even with an audio-like name", () => {
    assert.equal(isAudioFile(file("clip.mp4", "video/mp4")), false);
    assert.equal(isAudioFile(file("notes.wav", "text/plain")), false);
  });

  it("falls back to the extension when the MIME type is unknown", () => {
    assert.equal(isAudioFile(file("Mix.WAV")), true);
    assert.equal(isAudioFile(file("mix.aiff")), true);
    assert.equal(isAudioFile(file("clip.mov")), false);
    assert.equal(isAudioFile(file("readme.txt")), false);
  });
});

describe("getDroppedAudioFile", () => {
  it("validates drops by extension when the MIME type is empty", () => {
    for (const name of [
      "a.mp3",
      "b.wav",
      "c.m4a",
      "d.flac",
      "e.aif",
      "f.aiff",
    ]) {
      const dropped = file(name);
      assert.equal(getDroppedAudioFile([dropped]), dropped);
    }
    assert.equal(getDroppedAudioFile([file("clip.mov")]), undefined);
  });

  it("picks the first audio file", () => {
    const wav = file("mix.wav", "audio/wav");
    assert.equal(
      getDroppedAudioFile([file("clip.mp4", "video/mp4"), wav]),
      wav,
    );
  });

  it("returns undefined when nothing is audio", () => {
    assert.equal(
      getDroppedAudioFile([file("clip.mp4", "video/mp4")]),
      undefined,
    );
    assert.equal(getDroppedAudioFile(null), undefined);
  });
});

describe("getMainAudioDragState", () => {
  it("accepts audio file items during dragover", () => {
    assert.equal(
      getMainAudioDragState({
        types: ["Files"],
        files: [],
        items: [{ kind: "file", type: "audio/mpeg" }],
      }),
      "accept",
    );
  });

  it("rejects non-audio file items", () => {
    assert.equal(
      getMainAudioDragState({
        types: ["Files"],
        files: [],
        items: [{ kind: "file", type: "video/mp4" }],
      }),
      "reject",
    );
    assert.equal(
      getMainAudioDragState({
        types: ["Files"],
        files: [],
        items: [
          { kind: "file", type: "video/mp4" },
          { kind: "file", type: "image/png" },
        ],
      }),
      "reject",
    );
  });

  it("accepts file items whose MIME type is unknown", () => {
    assert.equal(
      getMainAudioDragState({
        types: ["Files"],
        files: [],
        items: [{ kind: "file", type: "" }],
      }),
      "accept",
    );
    assert.equal(
      getMainAudioDragState({
        types: ["Files"],
        files: [],
        items: [{ kind: "file", type: "application/octet-stream" }],
      }),
      "accept",
    );
  });

  it("accepts a mix of non-audio and possibly audio items", () => {
    assert.equal(
      getMainAudioDragState({
        types: ["Files"],
        files: [],
        items: [
          { kind: "file", type: "video/mp4" },
          { kind: "file", type: "" },
        ],
      }),
      "accept",
    );
  });

  it("accepts file drags that expose no items", () => {
    assert.equal(
      getMainAudioDragState({ types: ["Files"], files: [], items: [] }),
      "accept",
    );
    assert.equal(getMainAudioDragState({ types: ["Files"] }), "accept");
  });

  it("uses exposed files when available", () => {
    assert.equal(
      getMainAudioDragState({ types: ["Files"], files: [file("mix.flac")] }),
      "accept",
    );
    assert.equal(
      getMainAudioDragState({ types: ["Files"], files: [file("image.png")] }),
      "reject",
    );
  });

  it("ignores drags that carry no files", () => {
    assert.equal(
      getMainAudioDragState({
        types: ["text/plain"],
        items: [{ kind: "string", type: "text/plain" }],
      }),
      "none",
    );
    assert.equal(getMainAudioDragState(null), "none");
  });
});

describe("isWithinMainAudioDropTarget", () => {
  it("matches elements inside the Audio lane", () => {
    const inside = {
      closest: (selector: string) =>
        selector === `[${MAIN_AUDIO_DROP_TARGET_ATTRIBUTE}]` ? {} : null,
    };
    const outside = { closest: () => null };
    assert.equal(
      isWithinMainAudioDropTarget(inside as unknown as EventTarget),
      true,
    );
    assert.equal(
      isWithinMainAudioDropTarget(outside as unknown as EventTarget),
      false,
    );
    assert.equal(isWithinMainAudioDropTarget(null), false);
    assert.equal(
      isWithinMainAudioDropTarget({
        parentElement: inside,
      } as unknown as EventTarget),
      true,
    );
    assert.equal(
      isWithinMainAudioDropTarget({
        parentElement: null,
      } as unknown as EventTarget),
      false,
    );
  });
});

describe("Audio lane wiring", () => {
  it("lets HTML5 file drops reach the desktop app's webview", () => {
    const mainWindow = tauriConf.app.windows.find(
      (window: { label: string }) => window.label === "main",
    );
    assert.equal(mainWindow?.dragDropEnabled, false);
  });

  it("marks the Audio lane as a main-audio drop target", () => {
    const lane = mainAudioRowTsx.slice(
      mainAudioRowTsx.indexOf('aria-label="Main audio drop area"'),
      mainAudioRowTsx.indexOf(
        '<div className="track-label">',
        mainAudioRowTsx.indexOf('aria-label="Main audio drop area"'),
      ),
    );
    assert.match(lane, /track-row--bus/);
    assert.match(lane, new RegExp(`${MAIN_AUDIO_DROP_TARGET_ATTRIBUTE}=`));
    assert.match(lane, /onDrop=\{handleMainAudioDrop\}/);
    assert.match(lane, /onDragOver=\{handleMainAudioDragEvent\}/);
  });

  it("keeps window-level drop handling off the Audio lane", () => {
    const handlers = useSourceTrackDropTs.match(
      /hasDraggedFileData\(event\.dataTransfer\) \|\|\s+isWithinMainAudioDropTarget\(event\.target\)/g,
    );
    assert.equal(handlers?.length, 2);
  });

  it("routes Audio lane drops through replaceMainAudioFromFile only", () => {
    const start = useMainAudioTs.indexOf(
      "const handleMainAudioDrop = useCallback",
    );
    const body = useMainAudioTs.slice(
      start,
      useMainAudioTs.indexOf("\n  );\n", start),
    );
    assert.match(body, /replaceMainAudioFromFile\(file\)/);
    assert.doesNotMatch(body, /importMediaIntoSourceTrack/);
  });
});
