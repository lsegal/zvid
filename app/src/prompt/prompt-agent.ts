// The prompt box's tool-calling loop: sends the user's prompt to the model
// with the control surface's commands as tools, runs each command the model
// calls, and hands the results back until the model answers in words.

// The control surface's shape as the loop uses it (see control/surface.ts).
export type PromptTool = {
  name: string;
  description: string;
  inputSchema: object;
};

export type PromptCommandResult =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string } };

export type PromptSurface = {
  tools(): PromptTool[];
  call(name: string, input?: unknown): Promise<PromptCommandResult>;
};

// A Responses API item, as sent and returned.
export type ResponseItem = { type: string } & Record<string, unknown>;

export type ResponsesRequest = {
  instructions: string;
  input: ResponseItem[];
  tools: object[];
  include: string[];
};

// The fields of a completed Responses API response the loop reads.
export type CompletedResponse = { output?: ResponseItem[] };

// Sends one request and resolves with its completed response.
export type RespondFn = (
  request: ResponsesRequest,
) => Promise<CompletedResponse>;

export type PromptStep = { command: string; ok: boolean; message?: string };

export type PromptOutcome = {
  // The model's closing words, or why the loop stopped.
  reply: string;
  steps: PromptStep[];
  // True when the loop hit its turn cap before the model finished.
  truncated: boolean;
};

export const PROMPT_NAMESPACE = "zvid";
export const MAX_PROMPT_TURNS = 16;

export const PROMPT_INSTRUCTIONS = `You are the assistant built into zvid, a music-video editor where clips sit on layers in a timeline measured in quarter notes. The user types one request at a time into a prompt box.

Do what the user asks by calling the zvid tools, which edit the open session directly. Read the session first when you need to know what's in it, such as which clip is selected, its ID, or which effects exist; never guess IDs. When a tool returns an error, read it, fix the input and try again, or explain what stopped you.

When you're done, reply with one or two short sentences saying what you changed. Don't ask follow-up questions unless the request can't be carried out without an answer.`;

export function buildTools(surface: PromptSurface): object[] {
  return [
    {
      type: "namespace",
      name: PROMPT_NAMESPACE,
      description: "Commands that read and edit the open zvid session.",
      tools: surface.tools().map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
    },
  ];
}

// A function call's command name, without any namespace prefix the model
// may have kept.
export function commandName(item: ResponseItem): string {
  const name = String(item.name ?? "");
  for (const separator of [".", "__", "/", ":"]) {
    const prefix = `${PROMPT_NAMESPACE}${separator}`;
    if (name.startsWith(prefix)) {
      return name.slice(prefix.length);
    }
  }
  return name;
}

function parseArguments(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.trim() === "") {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// The text of the response's assistant messages.
export function replyText(output: ResponseItem[]): string {
  const parts: string[] = [];
  for (const item of output) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content as Array<Record<string, unknown>>) {
      if (part.type === "output_text" && typeof part.text === "string") {
        parts.push(part.text);
      }
    }
  }
  return parts.join("\n").trim();
}

// Output items to send back as input. Nothing is stored server-side, so
// item IDs would point at nothing; reasoning travels as encrypted content.
function asInput(item: ResponseItem): ResponseItem {
  const { id: _id, ...rest } = item;
  return rest as ResponseItem;
}

export async function runPrompt({
  prompt,
  surface,
  respond,
  maxTurns = MAX_PROMPT_TURNS,
  signal,
  onStep,
}: {
  prompt: string;
  surface: PromptSurface;
  respond: RespondFn;
  maxTurns?: number;
  signal?: AbortSignal;
  onStep?: (step: PromptStep) => void;
}): Promise<PromptOutcome> {
  const tools = buildTools(surface);
  const input: ResponseItem[] = [
    { type: "message", role: "user", content: prompt },
  ];
  const steps: PromptStep[] = [];

  for (let turn = 0; turn < maxTurns; turn += 1) {
    signal?.throwIfAborted();
    const response = await respond({
      instructions: PROMPT_INSTRUCTIONS,
      input: [...input],
      tools,
      include: ["reasoning.encrypted_content"],
    });
    signal?.throwIfAborted();
    const output = response.output ?? [];
    const calls = output.filter((item) => item.type === "function_call");
    if (!calls.length) {
      return { reply: replyText(output), steps, truncated: false };
    }
    input.push(...output.map(asInput));
    for (const call of calls) {
      const command = commandName(call);
      const result = await surface.call(
        command,
        parseArguments(call.arguments),
      );
      const step: PromptStep = result.ok
        ? { command, ok: true }
        : { command, ok: false, message: result.error.message };
      steps.push(step);
      onStep?.(step);
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
    }
  }
  return {
    reply: `Stopped after ${maxTurns} rounds of commands without finishing.`,
    steps,
    truncated: true,
  };
}
