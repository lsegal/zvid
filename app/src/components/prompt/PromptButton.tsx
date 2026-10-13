import { ChatBubbleBottomCenterTextIcon } from "@heroicons/react/24/solid";
import { useEffect, useRef, useState } from "react";
import {
  type ChatGptClient,
  loadChatGptClient,
} from "../../prompt/chatgpt-client";
import type { PromptSurface } from "../../prompt/prompt-agent";
import { PromptPalette } from "./PromptPalette";

// The control surface the running app installs (see useControlSurface.ts).
const appSurface = () => window.zvid;

type PromptButtonProps = {
  // Stand-ins for tests; the app uses the native client and `window.zvid`.
  client?: ChatGptClient;
  getSurface?: () => PromptSurface | undefined;
};

// The transport bar's prompt button, beside the wand: opens the prompt box.
export function PromptButton({
  client: givenClient,
  getSurface = appSurface,
}: PromptButtonProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [client, setClient] = useState<ChatGptClient | undefined>(givenClient);

  useEffect(() => {
    if (givenClient || !open || client) return;
    let current = true;
    void loadChatGptClient().then((loaded) => current && setClient(loaded));
    return () => {
      current = false;
    };
  }, [client, givenClient, open]);

  return (
    <>
      <button
        aria-label="Prompt zvid"
        aria-haspopup="dialog"
        className="transport-button transport-button--prompt"
        onClick={() => setOpen(true)}
        ref={buttonRef}
        title="Tell zvid what to do, on your ChatGPT plan"
        type="button"
      >
        <ChatBubbleBottomCenterTextIcon aria-hidden="true" />
      </button>
      {client ? (
        <PromptPalette
          client={client}
          getSurface={getSurface}
          onOpenChange={setOpen}
          open={open}
          returnFocus={() => buttonRef.current?.focus()}
        />
      ) : null}
    </>
  );
}
