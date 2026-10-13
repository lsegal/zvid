import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INITIAL_PROJECT_STATE } from "../app/constants.ts";
import type { LoopRegion } from "../app/loop-region.ts";
import {
  createNewSessionHistory,
  isPristineProjectHistory,
} from "../app/new-session.ts";
import { patchProjectState } from "../app/session-project.ts";
import type { ProjectState } from "../app/types.ts";
import { clipEffectTrackId, GLOBAL_EFFECT_TRACK_ID } from "../fx-stack.ts";
import type { MediaItem } from "../media.ts";
import {
  createProjectHistoryState,
  type ProjectHistoryState,
  projectHistoryReducer,
} from "../project-history.ts";
import { addMediaToSourceTrack } from "../source-track-media.ts";
import { fileNameFromUrl } from "./commands/media.ts";
import { CONTROL_COMMANDS, createControlSurface } from "./surface.ts";
import type {
  ControlExportRequest,
  ControlHost,
  ControlResult,
} from "./types.ts";

function mediaItem(id: string, name: string): MediaItem {
  return {
    id,
    name,
    kind: "video",
    durationSeconds: 8,
    width: 1280,
    height: 720,
    hasAudio: true,
    hasVideo: true,
    color: "#336699",
    accent: "#6699cc",
    previewUrl: `blob:${id}`,
    availability: "ready",
  };
}

// A stand-in for the running app: the project history, transport state and
// media import and export, all in memory.
function createTestHost() {
  let history: ProjectHistoryState<ProjectState> = createProjectHistoryState(
    INITIAL_PROJECT_STATE,
  );
  let playheadQ = 0;
  let playing = false;
  let loop: LoopRegion | null = null;
  let selectedClipId: string | undefined;
  let readOnly = false;
  let mediaCount = 0;
  const exports: ControlExportRequest[] = [];
  const fetched: string[] = [];
  const dispatch = (
    action: Parameters<typeof projectHistoryReducer<ProjectState>>[1],
  ) => {
    history = projectHistoryReducer(history, action);
  };
  const host: ControlHost = {
    getProject: () => history.present,
    commit: (label, updater) => dispatch({ type: "commit", label, updater }),
    isReadOnly: () => readOnly,
    canUndo: () => history.past.at(-1)?.label,
    canRedo: () => history.future[0]?.label,
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
    newSession: () => {
      history = createNewSessionHistory();
    },
    hasUnsavedChanges: () => !isPristineProjectHistory(history),
    newSessionBlocker: () => undefined,
    getPlayheadQ: () => playheadQ,
    setPlayheadQ: (quarters) => {
      playheadQ = quarters;
    },
    isPlaying: () => playing,
    play: () => {
      playing = history.present.clips.length > 0;
      return playing;
    },
    pause: () => {
      playing = false;
    },
    getLoop: () => loop,
    setLoop: (next) => {
      loop = next;
    },
    getSelectedClipId: () => selectedClipId,
    selectClip: (clipId) => {
      selectedClipId = clipId;
    },
    async importMedia(files, target) {
      const items = files.map((file) =>
        mediaItem(`media-${++mediaCount}`, file.name),
      );
      host.commit("Import media", (current) =>
        patchProjectState(current, {
          mediaItems: [...current.mediaItems, ...items],
          ...addMediaToSourceTrack(current, items, target),
        }),
      );
      return { imported: items };
    },
    async exportVideo(request) {
      exports.push(request);
      return {
        kind: "done",
        fileName: request.fileName,
        summary: "1920×1080 · 30 fps · H.264",
        bytes: 1234,
        mimeType: "video/mp4",
        url: "blob:export",
      };
    },
    canExportToPath: () => false,
    async fetch(url) {
      fetched.push(url);
      return new Response(new Blob(["video"], { type: "video/mp4" }));
    },
  };
  return {
    host,
    exports,
    fetched,
    setReadOnly: (value: boolean) => {
      readOnly = value;
    },
  };
}

function ok(result: ControlResult) {
  assert.equal(
    result.ok,
    true,
    result.ok ? "" : `${result.error.code}: ${result.error.message}`,
  );
  return (result as { ok: true; result: unknown }).result as Record<
    string,
    // biome-ignore lint/suspicious/noExplicitAny: test results are JSON
    any
  >;
}

function failure(result: ControlResult) {
  assert.equal(result.ok, false);
  return (result as Extract<ControlResult, { ok: false }>).error;
}

describe("control surface tools", () => {
  it("describes every command as a tool with an object input schema", () => {
    const { host } = createTestHost();
    const tools = createControlSurface(host).tools();
    assert.equal(tools.length, CONTROL_COMMANDS.length);
    assert.equal(new Set(tools.map((tool) => tool.name)).size, tools.length);
    for (const tool of tools) {
      assert.match(tool.name, /^[a-z_]+$/);
      assert.ok(tool.description.length > 20, tool.name);
      assert.equal(tool.inputSchema.type, "object");
      assert.equal(tool.inputSchema.additionalProperties, false);
      for (const key of tool.inputSchema.required ?? []) {
        assert.ok(key in tool.inputSchema.properties, `${tool.name}.${key}`);
      }
    }
    // The tools are plain JSON, as a tool list sent to a model must be.
    assert.deepEqual(JSON.parse(JSON.stringify(tools)), tools);
  });

  it("covers sessions, layers, clips, effects, media, transport and export", () => {
    const names = CONTROL_COMMANDS.map((command) => command.name);
    for (const name of [
      "get_session",
      "new_session",
      "update_session",
      "add_layer",
      "add_clip",
      "update_clip",
      "delete_clip",
      "list_effects",
      "add_effect",
      "set_effect_parameter",
      "import_media",
      "set_playhead",
      "play",
      "set_loop",
      "select_clip",
      "export_video",
      "undo",
    ]) {
      assert.ok(names.includes(name), name);
    }
  });
});

describe("driving a session end to end", () => {
  it("creates a session, adds clips and effects, and exports", async () => {
    const { host, exports, fetched } = createTestHost();
    const zvid = createControlSurface(host);

    ok(await zvid.call("new_session"));
    const session = ok(
      await zvid.call("update_session", { name: "Robot cut", bpm: 100 }),
    );
    assert.equal(session.name, "Robot cut");
    assert.equal(session.bpm, 100);
    const layerId = session.layers[0].id;

    const imported = ok(
      await zvid.call("import_media", {
        url: "https://example.com/media/drums%20take.mp4?dl=1",
      }),
    );
    assert.deepEqual(fetched, [
      "https://example.com/media/drums%20take.mp4?dl=1",
    ]);
    assert.equal(imported.media[0].name, "drums take.mp4");
    assert.equal(imported.sourceClips.length, 1);
    const sourceClip = imported.sourceClips[0];

    const media = ok(
      await zvid.call("add_clip", {
        kind: "media",
        layerId,
        startBeats: 4,
        durationBeats: 8,
        sourceClipId: sourceClip.id,
      }),
    );
    assert.equal(media.clip.kind, "media");
    assert.equal(media.clip.layerId, layerId);
    assert.equal(media.clip.startBeats, 4);
    assert.equal(media.clip.durationBeats, 8);
    assert.equal(media.clip.mediaId, imported.media[0].id);
    // It shows the media from its start, not from four beats in.
    const placed = host
      .getProject()
      .clips.find((clip) => clip.id === media.clip.id);
    assert.equal(placed?.trimStartSeconds, 0);
    // Media with sound gets its Gain, as a clip made in the UI does.
    assert.deepEqual(
      media.effectIds.map(
        (effect: { effectName: string }) => effect.effectName,
      ),
      ["Gain"],
    );

    const layer = ok(
      await zvid.call("add_layer", { name: "Titles", index: 0 }),
    );
    const text = ok(
      await zvid.call("add_clip", {
        kind: "text",
        layerId: layer.id,
        startBeats: 0,
        durationBeats: 4,
        text: "Hello robots",
      }),
    );
    const textEffect = host
      .getProject()
      .effects.find(
        (effect) => effect.trackId === clipEffectTrackId(text.clip.id),
      );
    assert.equal(
      textEffect?.parameters.find((parameter) => parameter.key === "Text")
        ?.value,
      "Hello robots",
    );

    const reverb = ok(
      await zvid.call("add_effect", {
        effectName: "reverb",
        target: "clip",
        targetId: media.clip.id,
      }),
    );
    assert.equal(reverb.effectName, "Reverb");
    assert.equal(reverb.target, "clip");
    assert.equal(reverb.targetId, media.clip.id);
    const configured = ok(
      await zvid.call("set_effect_parameter", {
        effectId: reverb.id,
        key: "Size",
        value: 0.8,
      }),
    );
    assert.equal(configured.parameters.Size, 0.8);

    const blur = ok(
      await zvid.call("add_effect", {
        effectName: "GaussianBlur",
        target: "global",
      }),
    );
    assert.equal(blur.target, "global");
    assert.ok(
      host
        .getProject()
        .effects.some(
          (effect) =>
            effect.id === blur.id && effect.trackId === GLOBAL_EFFECT_TRACK_ID,
        ),
    );

    const exported = ok(
      await zvid.call("export_video", { startBeats: 0, endBeats: 12 }),
    );
    assert.equal(exported.url, "blob:export");
    assert.deepEqual(exports, [
      {
        fileName: "Robot cut.mp4",
        destination: "memory",
        range: { inQ: 0, outQ: 12 },
      },
    ]);

    const state = ok(await zvid.call("get_session"));
    assert.deepEqual(
      state.layers.map((item: { name: string }) => item.name),
      ["Titles", "Layer 1"],
    );
    assert.equal(state.clips.length, 2);
    assert.equal(state.media.length, 1);
    assert.equal(state.selectedClipId, text.clip.id);
  });

  it("moves, resizes and deletes clips, and undoes edits", async () => {
    const { host } = createTestHost();
    const zvid = createControlSurface(host);
    const layerId = host.getProject().lanes[0].id;
    const fill = ok(
      await zvid.call("add_clip", {
        kind: "fill",
        layerId,
        startBeats: 0,
        durationBeats: 4,
        color: "#ff3366",
      }),
    );
    const color = host
      .getProject()
      .effects.find((effect) => effect.id === fill.effectIds[0].id);
    assert.equal(
      color?.parameters.find((parameter) => parameter.key === "Color")?.value,
      "#ff3366",
    );

    const moved = ok(
      await zvid.call("update_clip", {
        clipId: fill.clip.id,
        startBeats: 8,
        durationBeats: 2,
      }),
    );
    assert.equal(moved.startBeats, 8);
    assert.equal(moved.durationBeats, 2);

    assert.deepEqual(ok(await zvid.call("undo")), { undid: "Move clip" });
    assert.equal(host.getProject().clips[0].startQ, 0);
    ok(await zvid.call("redo"));
    assert.equal(host.getProject().clips[0].startQ, 8);

    ok(await zvid.call("delete_clip", { clipId: fill.clip.id }));
    assert.equal(host.getProject().clips.length, 0);
    // Its Color went with it.
    assert.ok(
      !host
        .getProject()
        .effects.some(
          (effect) => effect.trackId === clipEffectTrackId(fill.clip.id),
        ),
    );
  });

  it("drives the playhead, playback, loop and selection", async () => {
    const { host } = createTestHost();
    const zvid = createControlSurface(host);
    assert.equal(failure(await zvid.call("play")).code, "unavailable");
    const fx = ok(
      await zvid.call("add_clip", {
        kind: "fx",
        layerId: host.getProject().lanes[0].id,
        startBeats: 0,
        durationBeats: 4,
      }),
    );
    assert.equal(
      ok(await zvid.call("set_playhead", { beats: 2 })).playheadBeats,
      2,
    );
    assert.equal(ok(await zvid.call("play")).isPlaying, true);
    assert.equal(ok(await zvid.call("pause")).isPlaying, false);
    assert.deepEqual(
      ok(await zvid.call("set_loop", { startBeats: 0, endBeats: 4 })).loop,
      { startBeats: 0, endBeats: 4 },
    );
    assert.equal(ok(await zvid.call("set_loop", {})).loop, null);
    assert.equal(
      failure(await zvid.call("set_loop", { startBeats: 4, endBeats: 2 })).code,
      "invalid_input",
    );
    assert.deepEqual(ok(await zvid.call("select_clip", {})), {
      selectedClipId: null,
    });
    assert.deepEqual(
      ok(await zvid.call("select_clip", { clipId: fx.clip.id })),
      {
        selectedClipId: fx.clip.id,
      },
    );
  });

  it("runs commands in the order they are called", async () => {
    const { host } = createTestHost();
    const zvid = createControlSurface(host);
    const [first, second] = await Promise.all([
      zvid.call("add_layer", { name: "A" }),
      zvid.call("add_layer", { name: "B" }),
    ]);
    assert.notEqual(ok(first).id, ok(second).id);
    assert.deepEqual(
      host
        .getProject()
        .lanes.slice(-2)
        .map((lane) => lane.name),
      ["A", "B"],
    );
  });
});

describe("control surface errors", () => {
  it("returns structured errors instead of throwing", async () => {
    const { host } = createTestHost();
    const zvid = createControlSurface(host);
    assert.equal(failure(await zvid.call("fly")).code, "unknown_command");

    const missing = failure(await zvid.call("add_clip", { kind: "fill" }));
    assert.equal(missing.code, "invalid_input");
    assert.deepEqual(missing.problems, [
      '"layerId" is required.',
      '"startBeats" is required.',
      '"durationBeats" is required.',
    ]);

    const wrong = failure(
      await zvid.call("add_layer", { name: 3, color: "red" }),
    );
    assert.deepEqual(wrong.problems, [
      '"name" must be a string, not number.',
      '"color" is not an input of this command; it takes "name", "index".',
    ]);

    assert.equal(
      failure(
        await zvid.call("add_clip", {
          kind: "text",
          layerId: "nope",
          startBeats: 0,
          durationBeats: 1,
        }),
      ).code,
      "not_found",
    );
    assert.equal(
      failure(
        await zvid.call("add_clip", {
          kind: "media",
          layerId: host.getProject().lanes[0].id,
          startBeats: 0,
          durationBeats: 1,
        }),
      ).code,
      "invalid_input",
    );
    assert.equal(
      failure(await zvid.call("update_session", { bpm: 999 })).code,
      "invalid_input",
    );
    assert.equal(
      failure(await zvid.call("update_session", { canvasWidth: 1281 })).code,
      "invalid_input",
    );
  });

  it("checks effects and their parameters against the registry", async () => {
    const { host } = createTestHost();
    const zvid = createControlSurface(host);
    const layerId = host.getProject().lanes[0].id;
    assert.equal(
      failure(
        await zvid.call("add_effect", {
          effectName: "Warp9",
          target: "global",
        }),
      ).code,
      "not_found",
    );
    // Order arranges several layers, so it only goes on the Global stack
    // or an FX clip.
    assert.equal(
      failure(
        await zvid.call("add_effect", {
          effectName: "Order",
          target: "layer",
          targetId: layerId,
        }),
      ).code,
      "unavailable",
    );
    assert.equal(
      failure(
        await zvid.call("add_effect", {
          effectName: "Reverb",
          target: "layer",
        }),
      ).code,
      "invalid_input",
    );

    const reverb = ok(
      await zvid.call("add_effect", {
        effectName: "Reverb",
        target: "layer",
        targetId: layerId,
      }),
    );
    const outOfRange = failure(
      await zvid.call("set_effect_parameter", {
        effectId: reverb.id,
        key: "Size",
        value: 4,
      }),
    );
    assert.equal(outOfRange.code, "invalid_input");
    assert.match(outOfRange.message, /outside 0–1/);
    assert.equal(
      failure(
        await zvid.call("set_effect_parameter", {
          effectId: reverb.id,
          key: "Wetness",
          value: 1,
        }),
      ).code,
      "not_found",
    );

    const effects = ok(await zvid.call("list_effects", { domain: "audio" }));
    const listed = (effects as unknown as { effectName: string }[]).find(
      (effect) => effect.effectName === "Reverb",
    );
    assert.ok(listed);
    assert.ok(
      !(effects as unknown as { domain: string }[]).some(
        (effect) => effect.domain !== "audio",
      ),
    );

    const layout = host
      .getProject()
      .effects.find(
        (effect) =>
          effect.trackId === layerId && effect.effectName === "Layout",
      );
    assert.ok(layout);
    assert.equal(
      failure(await zvid.call("remove_effect", { effectId: layout.id })).code,
      "unavailable",
    );
    ok(
      await zvid.call("update_effect", { effectId: reverb.id, enabled: false }),
    );
    assert.equal(
      host.getProject().effects.find((effect) => effect.id === reverb.id)
        ?.enabled,
      false,
    );
    ok(await zvid.call("remove_effect", { effectId: reverb.id }));
  });

  it("refuses edits in a read-only tab but still reads the session", async () => {
    const { host, setReadOnly } = createTestHost();
    const zvid = createControlSurface(host);
    setReadOnly(true);
    assert.equal(failure(await zvid.call("add_layer", {})).code, "unavailable");
    ok(await zvid.call("get_session"));
  });

  it("keeps the last layer and asks before discarding unsaved work", async () => {
    const { host } = createTestHost();
    const zvid = createControlSurface(host);
    const [first] = host.getProject().lanes;
    const added = ok(await zvid.call("add_layer", {}));
    ok(await zvid.call("delete_layer", { layerId: added.id }));
    assert.equal(
      failure(await zvid.call("delete_layer", { layerId: first.id })).code,
      "unavailable",
    );
    assert.equal(failure(await zvid.call("new_session")).code, "unavailable");
    ok(await zvid.call("new_session", { discardUnsavedChanges: true }));
    assert.equal(host.getProject(), INITIAL_PROJECT_STATE);
  });
});

describe("fileNameFromUrl", () => {
  it("takes the decoded last path segment of a URL", () => {
    assert.equal(fileNameFromUrl("https://x.test/a/b%20c.mov?y=1"), "b c.mov");
    assert.equal(fileNameFromUrl("data:video/mp4;base64,AAAA"), undefined);
    assert.equal(fileNameFromUrl("not a url"), undefined);
  });
});
