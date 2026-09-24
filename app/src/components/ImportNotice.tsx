import "./import-notice.css";

export type ImportNoticeContent = {
  tone: "summary" | "warning" | "error";
  title: string;
  lines: string[];
};

// Non-blocking card that reports what a Live set import brought in, what it
// could not, or why it failed. Editing continues underneath until it is dismissed.
export function ImportNotice({
  notice,
  onDismiss,
}: {
  notice: ImportNoticeContent;
  onDismiss: () => void;
}) {
  return (
    <section
      aria-live="polite"
      className={`import-notice import-notice--${notice.tone}`}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      <div className="import-notice__body">
        <strong className="import-notice__title">{notice.title}</strong>
        {notice.lines.map((line) => (
          <p className="import-notice__line" key={line}>
            {line}
          </p>
        ))}
      </div>
      <button
        aria-label="Dismiss"
        className="import-notice__dismiss"
        onClick={onDismiss}
        type="button"
      >
        ×
      </button>
    </section>
  );
}
