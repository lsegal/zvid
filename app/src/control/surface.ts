// zvid's control surface: every editing operation as a named command with a
// JSON Schema input, for robots and agents to drive the app with instead of
// the UI. The running app installs it as `window.zvid` (see
// useControlSurface.ts); SKILL.md tells an agent how to use it.
import { clipCommands } from "./commands/clips.ts";
import { effectCommands } from "./commands/effects.ts";
import { layerCommands } from "./commands/layers.ts";
import { mediaCommands } from "./commands/media.ts";
import { sessionCommands } from "./commands/session.ts";
import { transportCommands } from "./commands/transport.ts";
import { type ControlInputSchema, validateInput } from "./schema.ts";
import {
  type ControlCommand,
  ControlFailure,
  type ControlHost,
  type ControlResult,
} from "./types.ts";

export const CONTROL_COMMANDS: readonly ControlCommand[] = [
  ...sessionCommands,
  ...layerCommands,
  ...clipCommands,
  ...effectCommands,
  ...mediaCommands,
  ...transportCommands,
];

// A command as a tool: the shape MCP's tools/list and most tool-calling APIs
// take.
export type ControlTool = {
  name: string;
  description: string;
  inputSchema: ControlInputSchema;
};

export type ControlSurface = {
  // The commands as tools, for a model's tool list.
  tools(): ControlTool[];
  // Runs command `name` with `input`. Never throws.
  call(name: string, input?: unknown): Promise<ControlResult>;
};

export function createControlSurface(
  host: ControlHost,
  commands: readonly ControlCommand[] = CONTROL_COMMANDS,
): ControlSurface {
  const byName = new Map(commands.map((command) => [command.name, command]));
  // Commands run one at a time, in the order they were called, so each
  // sees the edits of the ones before it.
  let queue: Promise<unknown> = Promise.resolve();

  async function run(name: string, input: unknown): Promise<ControlResult> {
    const command = byName.get(name);
    if (!command) {
      return {
        ok: false,
        error: {
          code: "unknown_command",
          message: `There is no "${name}" command. Commands: ${[...byName.keys()].join(", ")}.`,
        },
      };
    }
    const problems = validateInput(command.inputSchema, input);
    if (problems.length) {
      return {
        ok: false,
        error: {
          code: "invalid_input",
          message: `Invalid input for ${name}: ${problems.join(" ")}`,
          problems,
        },
      };
    }
    if (command.edits && host.isReadOnly()) {
      return {
        ok: false,
        error: {
          code: "unavailable",
          message:
            "This tab is read-only because the session is open in another tab.",
        },
      };
    }
    try {
      const result = await command.run(
        host,
        (input ?? {}) as Record<string, unknown>,
      );
      return { ok: true, result: result ?? null };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof ControlFailure
            ? { code: error.code, message: error.message }
            : {
                code: "failed",
                message: error instanceof Error ? error.message : String(error),
              },
      };
    }
  }

  return {
    tools: () =>
      commands.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    call(name, input) {
      const result = queue.then(() => run(name, input));
      queue = result;
      return result;
    },
  };
}
