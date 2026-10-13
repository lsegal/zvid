import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  SparklesIcon,
} from "@heroicons/react/24/solid";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  type ChatGptClient,
  type ChatGptStatus,
  SIGNED_OUT_CODES,
  toChatGptError,
  USAGE_LIMIT_CODE,
} from "../../prompt/chatgpt-client";
import {
  type PromptStep,
  type PromptSurface,
  runPrompt,
} from "../../prompt/prompt-agent";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import "./prompt-palette.css";

type PromptPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: ChatGptClient;
  // The control surface the model's commands run on, when the app has one.
  getSurface: () => PromptSurface | undefined;
};

type RunState =
  | { kind: "idle" }
  | { kind: "running"; steps: PromptStep[] }
  | { kind: "done"; reply: string; steps: PromptStep[] }
  | { kind: "failed"; message: string; code?: string; steps: PromptStep[] };

// The connection to ChatGPT: loading, signed in or out, or mid-sign-in.
type Connection =
  | { kind: "loading" }
  | { kind: "ready"; status: ChatGptStatus }
  | { kind: "signing-in"; status: ChatGptStatus };

function StepList({ steps }: { steps: PromptStep[] }) {
  if (!steps.length) return null;
  return (
    <ol className="prompt-palette__steps" aria-label="Commands run">
      {steps.map((step, index) => (
        <li
          // Steps only append, so their order is stable.
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
          key={index}
          className={step.ok ? undefined : "prompt-palette__step--failed"}
          title={step.message}
        >
          {step.ok ? (
            <CheckCircleIcon aria-hidden="true" />
          ) : (
            <ExclamationCircleIcon aria-hidden="true" />
          )}
          {step.command}
        </li>
      ))}
    </ol>
  );
}

// The prompt box: a Spotlight-style field that turns a request into zvid
// commands, run by the model on the user's ChatGPT plan.
export function PromptPalette({
  open,
  onOpenChange,
  client,
  getSurface,
}: PromptPaletteProps) {
  const [prompt, setPrompt] = useState("");
  const [connection, setConnection] = useState<Connection>({ kind: "loading" });
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const signingInRef = useRef(false);
  signingInRef.current = connection.kind === "signing-in";

  useEffect(() => {
    if (!open) return;
    let current = true;
    client
      .status()
      .then((status) => current && setConnection({ kind: "ready", status }))
      .catch(
        () =>
          current &&
          setConnection({
            kind: "ready",
            status: { available: true, signedIn: false, planUsage: false },
          }),
      );
    return () => {
      current = false;
    };
  }, [client, open]);

  // Closing stops a prompt in progress; its finished commands stay done.
  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setRun((state) => (state.kind === "running" ? { kind: "idle" } : state));
    if (signingInRef.current) void client.cancelSignIn();
  }, [client, open]);

  const status = connection.kind === "loading" ? null : connection.status;
  const ready = !!status?.signedIn && status.planUsage;
  const running = run.kind === "running";

  async function signIn() {
    if (!status) return;
    setNotice(null);
    setConnection({ kind: "signing-in", status });
    try {
      const next = await client.signIn();
      setConnection({ kind: "ready", status: next });
      setRun({ kind: "idle" });
      inputRef.current?.focus();
    } catch (error) {
      const failure = toChatGptError(error);
      setConnection((state) =>
        state.kind === "signing-in" ? { kind: "ready", status } : state,
      );
      if (failure.code !== "canceled") setNotice(failure.message);
    }
  }

  async function cancelSignIn() {
    await client.cancelSignIn();
  }

  async function signOut() {
    try {
      const next = await client.signOut();
      setConnection({ kind: "ready", status: next });
      setNotice(next.notice ?? null);
    } catch (error) {
      setNotice(toChatGptError(error).message);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || running || !ready) return;
    const surface = getSurface();
    if (!surface) {
      setRun({
        kind: "failed",
        message: "zvid isn't ready for commands yet. Try again in a moment.",
        steps: [],
      });
      return;
    }
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setNotice(null);
    setRun({ kind: "running", steps: [] });
    const steps: PromptStep[] = [];
    try {
      const outcome = await runPrompt({
        prompt: text,
        surface,
        respond: (request) => client.respond(request),
        signal: controller.signal,
        onStep: (step) => {
          steps.push(step);
          if (!controller.signal.aborted) {
            setRun({ kind: "running", steps: [...steps] });
          }
        },
      });
      if (controller.signal.aborted) return;
      setRun({
        kind: "done",
        reply: outcome.reply || "Done.",
        steps: outcome.steps,
      });
      setPrompt("");
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure = toChatGptError(error);
      setRun({
        kind: "failed",
        message: failure.message,
        code: failure.code,
        steps: [...steps],
      });
      if (failure.code && SIGNED_OUT_CODES.has(failure.code)) {
        client
          .status()
          .then((next) => setConnection({ kind: "ready", status: next }))
          .catch(() => {});
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  const manageUsage = (
    <button
      className="prompt-palette__link"
      onClick={() => void client.openUsage()}
      type="button"
    >
      Manage usage
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="prompt-palette"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        // Typing here must not reach the editor's shortcuts.
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
      >
        <DialogTitle className="prompt-palette__title">Prompt zvid</DialogTitle>
        <form className="prompt-palette__form" onSubmit={submit}>
          <SparklesIcon aria-hidden="true" className="prompt-palette__icon" />
          <input
            aria-label="Prompt"
            autoComplete="off"
            className="prompt-palette__input"
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={
              ready
                ? "Tell zvid what to do, like “add a reverb to the selected clip”"
                : "Sign in with ChatGPT to prompt zvid"
            }
            readOnly={running}
            ref={inputRef}
            spellCheck={false}
            value={prompt}
          />
        </form>

        {run.kind !== "idle" ? (
          <div
            aria-live="polite"
            className={`prompt-palette__result prompt-palette__result--${run.kind}`}
            role="status"
          >
            <p>
              {run.kind === "running"
                ? "Working…"
                : run.kind === "done"
                  ? run.reply
                  : run.message}
            </p>
            <StepList steps={run.steps} />
            {run.kind === "failed" && run.code === USAGE_LIMIT_CODE
              ? manageUsage
              : null}
          </div>
        ) : null}

        <div className="prompt-palette__account">
          {connection.kind === "loading" ? (
            <span>Checking your ChatGPT sign-in…</span>
          ) : connection.kind === "signing-in" ? (
            <>
              <span>Finish signing in in your browser…</span>
              <button
                className="prompt-palette__link"
                onClick={() => void cancelSignIn()}
                type="button"
              >
                Cancel
              </button>
            </>
          ) : !connection.status.available ? (
            <span>
              Prompts run on your ChatGPT plan through Sign in with ChatGPT,
              which works in the zvid desktop app.
            </span>
          ) : ready ? (
            <>
              <span>
                Using ChatGPT plan
                {connection.status.email ? ` · ${connection.status.email}` : ""}
              </span>
              {manageUsage}
              <button
                className="prompt-palette__link"
                disabled={running}
                onClick={() => void signOut()}
                type="button"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <span>
                {connection.status.signedIn
                  ? "Allow zvid to use your ChatGPT plan to run prompts."
                  : "Prompts run on your ChatGPT plan. No API key needed."}
              </span>
              <button
                className="prompt-palette__chatgpt"
                onClick={() => void signIn()}
                type="button"
              >
                Continue with ChatGPT
              </button>
            </>
          )}
        </div>
        {notice ? (
          <p className="prompt-palette__notice" role="alert">
            {notice}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
