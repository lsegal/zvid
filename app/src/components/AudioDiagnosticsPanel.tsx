import { useEffect, useRef, useState } from "react";
import { audioDiagnostics } from "../audio-mix/audio-diagnostics.ts";
import "./audio-diagnostics-panel.css";

const REFRESH_MS = 1000;

// The preview audio diagnostics report, shown with `?debugAudio=1` so a
// tester on a device we lack can copy it into an issue (#1111).
export function AudioDiagnosticsPanel() {
  const [report, setReport] = useState(() => audioDiagnostics.report());
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const text = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const timer = window.setInterval(
      () => setReport(audioDiagnostics.report()),
      REFRESH_MS,
    );
    return () => window.clearInterval(timer);
  }, []);

  const copy = async () => {
    const current = audioDiagnostics.report();
    setReport(current);
    try {
      await navigator.clipboard.writeText(current);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Without clipboard access, select the text to copy by hand.
      const node = text.current;
      const selection = window.getSelection();
      if (node && selection) {
        selection.selectAllChildren(node);
      }
    }
  };

  return (
    <section className="audio-diagnostics" aria-label="Audio diagnostics">
      <header className="audio-diagnostics__header">
        <strong>Audio diagnostics</strong>
        <button type="button" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy report"}
        </button>
        <button
          type="button"
          onClick={() => {
            audioDiagnostics.reset();
            setReport(audioDiagnostics.report());
          }}
        >
          Reset counters
        </button>
        <button type="button" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Show"}
        </button>
      </header>
      {open ? (
        <pre ref={text} className="audio-diagnostics__report">
          {report}
        </pre>
      ) : null}
    </section>
  );
}
