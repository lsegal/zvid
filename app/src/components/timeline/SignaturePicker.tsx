import { useState } from "react";
import type { ProjectState } from "../../app/types.ts";
import {
  parseSignature,
  signatureById,
  stepSignature,
} from "../../time-signature.ts";

// The timeline toolbar's time signature: -/+ step along the signature
// ladder like the zoom buttons, and any N/M can be typed into the field,
// which applies on Enter or blur and reverts on Escape. Arrow Up and Down
// in the field step too.
export function SignaturePicker({
  signatureId,
  commitProjectPatch,
}: {
  signatureId: string;
  commitProjectPatch: (label: string, patch: Partial<ProjectState>) => void;
}) {
  const signature = signatureById(signatureId);
  const [draft, setDraft] = useState<string | null>(null);
  const previous = stepSignature(signature, -1);
  const next = stepSignature(signature, 1);

  const apply = (id: string) => {
    setDraft(null);
    if (id !== signatureId) {
      commitProjectPatch("Change time signature", { signatureId: id });
    }
  };
  // A typed signature that doesn't parse puts back the current one.
  const applyDraft = () => {
    if (draft !== null) {
      apply(parseSignature(draft)?.id ?? signatureId);
    }
  };

  return (
    <div className="signature-picker">
      <span>Time Sig</span>
      <button
        aria-label="Previous time signature"
        className="signature-picker__adjust"
        disabled={!previous}
        onClick={() => previous && apply(previous.id)}
        type="button"
      >
        −
      </button>
      <input
        aria-label="Time signature"
        className="signature-picker__input"
        onBlur={applyDraft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            applyDraft();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(null);
          } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const step = stepSignature(
              parseSignature(draft ?? "") ?? signature,
              event.key === "ArrowUp" ? 1 : -1,
            );
            if (step) {
              apply(step.id);
            }
          }
        }}
        placeholder="N/M"
        spellCheck={false}
        title="Type any signature as N/M, such as 7/5"
        type="text"
        value={draft ?? signature.id}
      />
      <button
        aria-label="Next time signature"
        className="signature-picker__adjust"
        disabled={!next}
        onClick={() => next && apply(next.id)}
        type="button"
      >
        +
      </button>
    </div>
  );
}
