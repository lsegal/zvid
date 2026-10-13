// The webview's side of Sign in with ChatGPT. The desktop app's native side
// signs in, keeps the tokens and talks to OpenAI (see src-tauri/src/chatgpt);
// the web app can't, since the sign-in needs a loopback callback and tokens
// kept out of browser storage.
import type { CompletedResponse, ResponsesRequest } from "./prompt-agent.ts";

export type ChatGptStatus = {
  // False in the web app, which can't sign in.
  available: boolean;
  signedIn: boolean;
  email?: string | null;
  // Whether the user let zvid use their ChatGPT plan.
  planUsage: boolean;
  notice?: string | null;
};

export type ChatGptClient = {
  status(): Promise<ChatGptStatus>;
  // Opens the browser to sign in and resolves once it returns.
  signIn(): Promise<ChatGptStatus>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<ChatGptStatus>;
  // Opens ChatGPT's usage settings in the browser.
  openUsage(): Promise<void>;
  respond(request: ResponsesRequest): Promise<CompletedResponse>;
};

// Codes worth a specific action in the UI; others show their message.
export const USAGE_LIMIT_CODE = "subscription_sharing_usage_limit_exceeded";
export const SIGNED_OUT_CODES = new Set([
  "signed_out",
  "plan_usage_disabled",
  "subscription_sharing_invalid_user",
]);

export class ChatGptError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ChatGptError";
    this.code = code;
  }
}

// The native side rejects with `{ code, message }`.
export function toChatGptError(error: unknown): ChatGptError {
  if (error instanceof ChatGptError) return error;
  if (error && typeof error === "object" && "message" in error) {
    const { message, code } = error as { message: unknown; code?: unknown };
    return new ChatGptError(
      String(message),
      typeof code === "string" ? code : undefined,
    );
  }
  return new ChatGptError(
    error instanceof Error ? error.message : String(error),
  );
}

type Invoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export function createNativeChatGptClient(invoke: Invoke): ChatGptClient {
  const call = async <T>(command: string, args?: Record<string, unknown>) => {
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      throw toChatGptError(error);
    }
  };
  const withAvailable = (status: Omit<ChatGptStatus, "available">) => ({
    ...status,
    available: true,
  });
  return {
    status: async () => withAvailable(await call("chatgpt_status")),
    signIn: async () => withAvailable(await call("chatgpt_sign_in")),
    cancelSignIn: () => call("chatgpt_cancel_sign_in"),
    signOut: async () => withAvailable(await call("chatgpt_sign_out")),
    openUsage: () => call("chatgpt_open_usage"),
    respond: (request) => call("chatgpt_respond", { request }),
  };
}

const unavailable = () =>
  Promise.reject(
    new ChatGptError(
      "Sign in with ChatGPT works in the zvid desktop app.",
      "unavailable",
    ),
  );

export const webChatGptClient: ChatGptClient = {
  status: async () => ({ available: false, signedIn: false, planUsage: false }),
  signIn: unavailable,
  cancelSignIn: async () => {},
  signOut: unavailable,
  openUsage: async () => {
    window.open("https://chatgpt.com/settings/usage", "_blank", "noopener");
  },
  respond: unavailable,
};

let client: Promise<ChatGptClient> | undefined;

// The native client in the desktop app, the web stand-in elsewhere.
export function loadChatGptClient(): Promise<ChatGptClient> {
  client ??= import("@tauri-apps/api/core")
    .then(({ invoke, isTauri }) =>
      isTauri() ? createNativeChatGptClient(invoke) : webChatGptClient,
    )
    .catch(() => webChatGptClient);
  return client;
}
