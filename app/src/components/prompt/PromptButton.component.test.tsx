import { afterEach, describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { type RenderResult, render } from "vitest-browser-react";
import { DEFAULT_PREVIEW_VOLUME } from "../../app/preview-volume.ts";
import { objectSchema } from "../../control/schema.ts";
import { createPlayheadSignal } from "../../playhead-signal.ts";
import {
  type ChatGptClient,
  ChatGptError,
  type ChatGptStatus,
  USAGE_LIMIT_CODE,
} from "../../prompt/chatgpt-client.ts";
import type {
  CompletedResponse,
  PromptSurface,
  ResponsesRequest,
} from "../../prompt/prompt-agent.ts";
import { TransportBar } from "../timeline/TransportBar";
import { PromptButton } from "./PromptButton";

// The transport bar's prompt button and its Spotlight-style prompt box,
// driven by a fake ChatGPT client and control surface; the loop's own
// request/response handling is covered in prompt-agent.test.ts.
const noop = () => {};
const SIGNED_IN: ChatGptStatus = {
  available: true,
  signedIn: true,
  email: "user@example.com",
  planUsage: true,
};
const SIGNED_OUT: ChatGptStatus = {
  available: true,
  signedIn: false,
  planUsage: false,
};

function fakeClient(
  initial: ChatGptStatus,
  respond: (request: ResponsesRequest) => Promise<CompletedResponse> = () =>
    Promise.resolve({ output: [] }),
) {
  let status = initial;
  const client = {
    status: vi.fn(async () => status),
    signIn: vi.fn(async () => {
      status = SIGNED_IN;
      return status;
    }),
    cancelSignIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {
      status = { ...SIGNED_IN, signedIn: false, planUsage: false };
      return status;
    }),
    openUsage: vi.fn(async () => {}),
    respond: vi.fn(respond),
  } satisfies ChatGptClient;
  return client;
}

// A surface whose selected clip gains each effect the model adds.
function fakeSurface() {
  const effects: string[] = [];
  const surface: PromptSurface = {
    tools: () => [
      {
        name: "add_effect",
        description: "Adds an effect to the selected clip.",
        inputSchema: objectSchema({}),
      },
    ],
    call: async (_name, input) => {
      effects.push((input as { effect: string }).effect);
      return { ok: true, result: null };
    },
  };
  return { surface, effects };
}

// A model that adds a reverb, then says so.
async function reverbModel(
  request: ResponsesRequest,
): Promise<CompletedResponse> {
  if (!request.input.some((item) => item.type === "function_call_output")) {
    return {
      output: [
        {
          type: "function_call",
          call_id: "c1",
          name: "add_effect",
          arguments: '{"effect":"reverb"}',
        },
      ],
    };
  }
  return {
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Added a reverb." }],
      },
    ],
  };
}

let screen: RenderResult | undefined;
afterEach(async () => {
  await screen?.unmount();
  screen = undefined;
});

async function renderButton(
  client: ChatGptClient,
  surface?: PromptSurface,
): Promise<RenderResult> {
  screen = await render(
    <div className="app-shell">
      <PromptButton client={client} getSurface={() => surface} />
    </div>,
  );
  return screen;
}

async function openPalette(view: RenderResult) {
  await view.getByRole("button", { name: "Prompt zvid" }).click();
  const input = view.getByRole("textbox", { name: "Prompt" });
  await expect.element(input).toHaveFocus();
  return input;
}

describe("the prompt button", () => {
  test("sits right after the wand in the transport bar", async () => {
    screen = await render(
      <div className="app-shell">
        <TransportBar
          canRecord={false}
          flushZoomDraft={noop}
          getMeterTap={() => null}
          isPlaying={false}
          isRecording={false}
          jumpHalfBar={noop}
          loopRegion={null}
          onRandomize={noop}
          onTransportToggle={noop}
          playbackEndQ={16}
          playFromLoopStart={noop}
          playheadSignal={createPlayheadSignal()}
          previewVolume={DEFAULT_PREVIEW_VOLUME}
          resolvedZoom={1}
          setPreviewVolume={noop}
          setZoomValue={noop}
          skipToEdge={noop}
          toggleRecording={noop}
          togglePreviewMute={noop}
          updateZoomDraft={noop}
        />
      </div>,
    );
    const wand = document.querySelector(".transport-button--wand");
    const prompt = document.querySelector(".transport-button--prompt");
    expect(wand?.nextElementSibling).toBe(prompt);
    expect(prompt?.getAttribute("aria-label")).toBe("Prompt zvid");
    const wandBox = wand?.getBoundingClientRect();
    const promptBox = prompt?.getBoundingClientRect();
    expect(promptBox?.height).toBe(wandBox?.height);
    expect(promptBox?.top).toBe(wandBox?.top);
  });

  test("opens a focused prompt box that Escape closes", async () => {
    const view = await renderButton(fakeClient(SIGNED_IN));
    await openPalette(view);
    await expect.element(view.getByText(/^Using ChatGPT plan/)).toBeVisible();

    await userEvent.keyboard("{Escape}");
    await expect
      .element(view.getByRole("dialog"), { timeout: 2000 })
      .not.toBeInTheDocument();
    await expect
      .element(view.getByRole("button", { name: "Prompt zvid" }))
      .toHaveFocus();
  });

  test("keeps typing away from the editor's shortcuts", async () => {
    const view = await renderButton(fakeClient(SIGNED_IN));
    const keys: string[] = [];
    const listener = (event: KeyboardEvent) => keys.push(event.key);
    window.addEventListener("keydown", listener);
    try {
      await openPalette(view);
      await userEvent.keyboard("a b");
      await expect
        .element(view.getByRole("textbox", { name: "Prompt" }))
        .toHaveValue("a b");
      expect(keys).toEqual([]);
    } finally {
      window.removeEventListener("keydown", listener);
    }
  });

  test("runs a prompt on Enter and reports what changed", async () => {
    const client = fakeClient(SIGNED_IN, reverbModel);
    const { surface, effects } = fakeSurface();
    const view = await renderButton(client, surface);
    await openPalette(view);

    await userEvent.keyboard("add a reverb to the selected clip{Enter}");

    await expect.element(view.getByText("Added a reverb.")).toBeVisible();
    expect(effects).toEqual(["reverb"]);
    expect(client.respond).toHaveBeenCalledTimes(2);
    await expect
      .element(view.getByRole("list", { name: "Commands run" }))
      .toHaveTextContent("add_effect");
    // The box clears for the next prompt.
    await expect
      .element(view.getByRole("textbox", { name: "Prompt" }))
      .toHaveValue("");
  });

  test("signs in with ChatGPT before prompting", async () => {
    const client = fakeClient(SIGNED_OUT, reverbModel);
    const { surface, effects } = fakeSurface();
    const view = await renderButton(client, surface);
    await openPalette(view);

    await userEvent.keyboard("add a reverb{Enter}");
    expect(client.respond).not.toHaveBeenCalled();

    await view.getByRole("button", { name: "Continue with ChatGPT" }).click();
    expect(client.signIn).toHaveBeenCalledOnce();
    await expect
      .element(view.getByText("Using ChatGPT plan · user@example.com"))
      .toBeVisible();

    await view.getByRole("textbox", { name: "Prompt" }).click();
    await userEvent.keyboard("{Enter}");
    await expect.element(view.getByText("Added a reverb.")).toBeVisible();
    expect(effects).toEqual(["reverb"]);
  });

  test("offers Manage usage when the plan's limit is reached", async () => {
    const client = fakeClient(SIGNED_IN, () =>
      Promise.reject(
        new ChatGptError("You've reached your usage limit.", USAGE_LIMIT_CODE),
      ),
    );
    const view = await renderButton(client, fakeSurface().surface);
    await openPalette(view);
    await userEvent.keyboard("add a reverb{Enter}");

    await expect
      .element(view.getByText("You've reached your usage limit."))
      .toBeVisible();
    const status = view.getByRole("status");
    await status.getByRole("button", { name: "Manage usage" }).click();
    expect(client.openUsage).toHaveBeenCalledOnce();
  });

  test("signs out", async () => {
    const client = fakeClient(SIGNED_IN);
    const view = await renderButton(client);
    await openPalette(view);
    await view.getByRole("button", { name: "Sign out" }).click();
    expect(client.signOut).toHaveBeenCalledOnce();
    await expect
      .element(view.getByRole("button", { name: "Continue with ChatGPT" }))
      .toBeVisible();
  });

  test("points the web app to the desktop app", async () => {
    const view = await renderButton(
      fakeClient({ available: false, signedIn: false, planUsage: false }),
    );
    await openPalette(view);
    await expect
      .element(view.getByText(/works in the zvid desktop app/))
      .toBeVisible();
    expect(
      document.querySelector(".prompt-palette__chatgpt"),
    ).not.toBeInTheDocument();
  });
});
