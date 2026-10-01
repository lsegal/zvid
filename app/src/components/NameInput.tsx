import { useEffect, useRef, useState } from "react";

// Inline editor for a layer or source track name: Enter or leaving the field
// saves, Escape cancels.
export function NameInput({
  label,
  initialName,
  onSubmit,
  onCancel,
}: {
  // The field's accessible name, such as "Layer name".
  label: string;
  initialName: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  const finish = (save: boolean) => {
    if (doneRef.current) {
      return;
    }

    doneRef.current = true;
    if (save) {
      onSubmit(name);
    } else {
      onCancel();
    }
  };

  // Waits a tick so the closing menu does not take focus back.
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <input
      aria-label={label}
      className="track-label__rename"
      maxLength={64}
      onBlur={() => finish(true)}
      onChange={(event) => setName(event.target.value)}
      onKeyDown={(event) => {
        // Keep app shortcuts (Delete, arrows, Space) away from the field.
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      ref={inputRef}
      type="text"
      value={name}
    />
  );
}
