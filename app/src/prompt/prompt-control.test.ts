import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INITIAL_PROJECT_STATE } from "../app/constants.ts";
import type { ProjectState } from "../app/types.ts";
import { createControlSurface } from "../control/surface.ts";
import type { ControlHost } from "../control/types.ts";
import { clipEffectTrackId } from "../fx-stack.ts";
import {
  createProjectHistoryState,
  type ProjectHistoryState,
  projectHistoryReducer,
} from "../project-history.ts";
import {
  type CompletedResponse,
  type ResponseItem,
  type ResponsesRequest,
  runPrompt,
} from "./prompt-agent.ts";

// The prompt loop driving the real control surface over an in-memory
// session, with a mocked model standing in for ChatGPT.
function createHost() {
  let history: ProjectHistoryState<ProjectState> = createProjectHistoryState(
    INITIAL_PROJECT_STATE,
  );
  let selectedClipId: string | undefined;
  const unused = () => {
    throw new Error("not used by these tests");
  };
  const host: ControlHost = {
    getProject: () => history.present,
    commit: (label, updater) => {
      history = projectHistoryReducer(history, {
        type: "commit",
        label,
        updater,
      });
    },
    isReadOnly: () => false,
    canUndo: () => history.past.at(-1)?.label,
    canRedo: () => history.future[0]?.label,
    undo: unused,
    redo: unused,
    newSession: unused,
    hasUnsavedChanges: () => history.past.length > 0,
    newSessionBlocker: () => undefined,
    getPlayheadQ: () => 0,
    setPlayheadQ: unused,
    isPlaying: () => false,
    play: unused,
    pause: unused,
    getLoop: () => null,
    setLoop: unused,
    getSelectedClipId: () => selectedClipId,
    selectClip: (clipId) => {
      selectedClipId = clipId;
    },
    importMedia: unused,
    exportVideo: unused,
    canExportToPath: () => false,
    fetch: unused,
  };
  return host;
}

function lastOutput(request: ResponsesRequest) {
  const item = request.input.at(-1);
  assert.equal(item?.type, "function_call_output");
  return JSON.parse(String(item?.output));
}

function functionCall(name: string, args: object): ResponseItem[] {
  return [
    {
      type: "function_call",
      call_id: `call-${name}`,
      name,
      arguments: JSON.stringify(args),
    },
  ];
}

describe("prompting the control surface", () => {
  it("adds a reverb to the selected clip", async () => {
    const host = createHost();
    const zvid = createControlSurface(host);
    const layerId = host.getProject().lanes[0].id;
    const added = await zvid.call("add_clip", {
      kind: "fill",
      layerId,
      startBeats: 0,
      durationBeats: 4,
      color: "#3366ff",
    });
    assert.ok(added.ok);
    const clipId = host.getSelectedClipId();
    assert.ok(clipId);

    // Reads the session, then adds a Reverb to the clip it says is selected.
    const respond = async (
      request: ResponsesRequest,
    ): Promise<CompletedResponse> => {
      const turn = request.input.filter(
        (item) => item.type === "function_call_output",
      ).length;
      if (turn === 0) {
        assert.ok(
          JSON.stringify(request.tools).includes('"name":"add_effect"'),
        );
        return { output: functionCall("get_session", {}) };
      }
      if (turn === 1) {
        const session = lastOutput(request).result;
        return {
          output: functionCall("add_effect", {
            effectName: "Reverb",
            target: "clip",
            targetId: session.selectedClipId,
          }),
        };
      }
      assert.equal(lastOutput(request).ok, true);
      return {
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Added a Reverb." }],
          },
        ],
      };
    };

    const outcome = await runPrompt({
      prompt: "add a reverb to the selected clip",
      surface: zvid,
      respond,
    });

    assert.equal(outcome.reply, "Added a Reverb.");
    assert.deepEqual(
      outcome.steps.map(({ command, ok }) => `${command}:${ok}`),
      ["get_session:true", "add_effect:true"],
    );
    const effects = host
      .getProject()
      .effects.filter((effect) => effect.trackId === clipEffectTrackId(clipId))
      .map((effect) => effect.effectName);
    assert.ok(effects.includes("Reverb"), `clip effects: ${effects}`);
    assert.equal(host.canUndo(), "Add Reverb");
  });
});
