import { useEffect, useRef, useState } from "react";
import type { FxParameterControlProps } from "../types";

// A text area for free text. Typing sends transient edits, and leaving the
// field commits them as one undo step.
export function TextControl({
  device,
  parameter,
  onSetParameter,
}: FxParameterControlProps) {
  const value = parameter.stringValue ?? "";
  const [draft, setDraft] = useState(value);
  const editingRef = useRef(false);
  const pendingRef = useRef<string | null>(null);

  // Follows edits made elsewhere, such as undo or a collaborator, except
  // while typing here.
  useEffect(() => {
    if (!editingRef.current) {
      setDraft(value);
    }
  }, [value]);

  return (
    <label className="fx-text">
      <span className="fx-text__label">{parameter.label}</span>
      <textarea
        data-fx-no-drag
        onBlur={() => {
          editingRef.current = false;
          const pending = pendingRef.current;
          pendingRef.current = null;
          if (pending !== null) {
            onSetParameter(device, parameter.key, pending, "commit");
          }
        }}
        onChange={(event) => {
          editingRef.current = true;
          pendingRef.current = event.target.value;
          setDraft(event.target.value);
          onSetParameter(
            device,
            parameter.key,
            event.target.value,
            "transient",
          );
        }}
        onFocus={() => {
          editingRef.current = true;
        }}
        rows={3}
        spellCheck={false}
        value={draft}
      />
    </label>
  );
}
