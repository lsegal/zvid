import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { objectSchema } from "../control/schema.ts";
import type { ControlResult } from "../control/types.ts";
import {
  buildTools,
  type CompletedResponse,
  commandName,
  type PromptSurface,
  type ResponseItem,
  type ResponsesRequest,
  replyText,
  runPrompt,
} from "./prompt-agent.ts";

// A surface with a selected clip that records the commands it runs.
function fakeSurface() {
  const calls: Array<{ name: string; input: unknown }> = [];
  const effects: string[] = [];
  const surface: PromptSurface = {
    tools: () => [
      {
        name: "get_selection",
        description: "The selected clip.",
        inputSchema: objectSchema({}),
      },
      {
        name: "add_effect",
        description: "Adds an effect to a clip.",
        inputSchema: objectSchema(
          {
            clipId: { type: "string", description: "The clip." },
            effect: { type: "string", description: "The effect." },
          },
          ["clipId", "effect"],
        ),
      },
    ],
    async call(name, input): Promise<ControlResult> {
      calls.push({ name, input });
      if (name === "get_selection") {
        return { ok: true, result: { clipId: "clip-7" } };
      }
      const { clipId, effect } = input as { clipId?: string; effect?: string };
      if (name === "add_effect" && clipId === "clip-7" && effect) {
        effects.push(effect);
        return { ok: true, result: { effectId: "fx-1" } };
      }
      return {
        ok: false,
        error: { code: "not_found", message: `No clip "${clipId}".` },
      };
    },
  };
  return { surface, calls, effects };
}

function call(callId: string, name: string, args: object): ResponseItem {
  return {
    type: "function_call",
    id: `fc_${callId}`,
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
  };
}

function message(text: string): ResponseItem {
  return {
    type: "message",
    id: "msg_1",
    role: "assistant",
    content: [{ type: "output_text", text }],
  };
}

// A model that answers with `script`'s responses in order, recording each
// request it was sent.
function scriptedModel(script: ResponseItem[][]) {
  const requests: ResponsesRequest[] = [];
  return {
    requests,
    respond: async (request: ResponsesRequest): Promise<CompletedResponse> => {
      requests.push(structuredClone(request));
      const output = script[requests.length - 1];
      assert.ok(output, "the model was asked more often than scripted");
      return { output };
    },
  };
}

describe("runPrompt", () => {
  it("adds a reverb to the selected clip through the commands", async () => {
    const { surface, calls, effects } = fakeSurface();
    const model = scriptedModel([
      [
        { type: "reasoning", id: "rs_1", encrypted_content: "opaque" },
        call("c1", "get_selection", {}),
      ],
      [call("c2", "zvid.add_effect", { clipId: "clip-7", effect: "reverb" })],
      [message("Added a reverb to the selected clip.")],
    ]);

    const outcome = await runPrompt({
      prompt: "add a reverb to the selected clip",
      surface,
      respond: model.respond,
    });

    assert.deepEqual(effects, ["reverb"]);
    assert.deepEqual(
      calls.map(({ name }) => name),
      ["get_selection", "add_effect"],
    );
    assert.deepEqual(outcome, {
      reply: "Added a reverb to the selected clip.",
      steps: [
        { command: "get_selection", ok: true },
        { command: "add_effect", ok: true },
      ],
      truncated: false,
    });

    const [first, second] = model.requests;
    assert.deepEqual(first.input, [
      {
        type: "message",
        role: "user",
        content: "add a reverb to the selected clip",
      },
    ]);
    assert.deepEqual(first.include, ["reasoning.encrypted_content"]);
    // The history goes back each turn, without server-side item IDs.
    assert.deepEqual(second.input.slice(1), [
      { type: "reasoning", encrypted_content: "opaque" },
      {
        type: "function_call",
        call_id: "c1",
        name: "get_selection",
        arguments: "{}",
      },
      {
        type: "function_call_output",
        call_id: "c1",
        output: JSON.stringify({ ok: true, result: { clipId: "clip-7" } }),
      },
    ]);
  });

  it("returns command errors to the model so it can recover", async () => {
    const { surface } = fakeSurface();
    const model = scriptedModel([
      [call("c1", "add_effect", { clipId: "nope", effect: "reverb" })],
      [message("There's no such clip.")],
    ]);
    const seen: string[] = [];

    const outcome = await runPrompt({
      prompt: "add a reverb",
      surface,
      respond: model.respond,
      onStep: (step) => seen.push(`${step.command}:${step.ok}`),
    });

    assert.deepEqual(seen, ["add_effect:false"]);
    assert.equal(outcome.steps[0].message, 'No clip "nope".');
    const output = model.requests[1].input.at(-1);
    assert.equal(output?.type, "function_call_output");
    assert.match(String(output?.output), /"code":"not_found"/);
  });

  it("stops at the turn cap", async () => {
    const { surface } = fakeSurface();
    const outcome = await runPrompt({
      prompt: "loop forever",
      surface,
      respond: async () => ({ output: [call("c", "get_selection", {})] }),
      maxTurns: 3,
    });

    assert.equal(outcome.truncated, true);
    assert.equal(outcome.steps.length, 3);
  });

  it("stops when aborted", async () => {
    const { surface } = fakeSurface();
    const controller = new AbortController();
    await assert.rejects(
      runPrompt({
        prompt: "add a reverb",
        surface,
        signal: controller.signal,
        respond: async () => {
          controller.abort();
          return { output: [call("c", "get_selection", {})] };
        },
      }),
      { name: "AbortError" },
    );
  });

  it("passes unparseable arguments on for the surface to reject", async () => {
    const { surface, calls } = fakeSurface();
    await runPrompt({
      prompt: "add a reverb",
      surface,
      respond: scriptedModel([
        [
          {
            type: "function_call",
            call_id: "c",
            name: "add_effect",
            arguments: "{",
          },
        ],
        [message("Done.")],
      ]).respond,
    });
    assert.deepEqual(calls[0], { name: "add_effect", input: "{" });
  });
});

describe("the prompt's tools", () => {
  it("groups the commands in a zvid namespace", () => {
    const [namespace] = buildTools(fakeSurface().surface) as Array<{
      type: string;
      name: string;
      tools: Array<{ type: string; name: string; parameters: object }>;
    }>;
    assert.equal(namespace.type, "namespace");
    assert.equal(namespace.name, "zvid");
    assert.deepEqual(
      namespace.tools.map(({ type, name }) => `${type}:${name}`),
      ["function:get_selection", "function:add_effect"],
    );
    assert.deepEqual(namespace.tools[1].parameters, {
      type: "object",
      properties: {
        clipId: { type: "string", description: "The clip." },
        effect: { type: "string", description: "The effect." },
      },
      required: ["clipId", "effect"],
      additionalProperties: false,
    });
  });

  it("reads command names with or without the namespace", () => {
    for (const name of ["add_effect", "zvid.add_effect", "zvid__add_effect"]) {
      assert.equal(commandName({ type: "function_call", name }), "add_effect");
    }
  });

  it("joins the reply's text parts", () => {
    assert.equal(
      replyText([
        { type: "reasoning" },
        message("First."),
        {
          type: "message",
          content: [
            { type: "refusal", refusal: "x" },
            { type: "output_text", text: "Second." },
          ],
        },
      ]),
      "First.\nSecond.",
    );
  });
});
