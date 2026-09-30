import { memo, useEffect, useState } from "react";
import {
  partitionStatusItems,
  STATUS_MESSAGE_TIMEOUT_MS,
  type StatusItem,
  type StatusMessage,
  statusMessageClears,
} from "../status-bar";
import "./status-bar.css";

export type { StatusItem, StatusMessage } from "../status-bar";

function StatusBarItem({ item }: { item: StatusItem }) {
  const content = (
    <>
      {item.label ? (
        <span className="status-bar__label">{item.label}</span>
      ) : null}
      <span className="status-bar__value">{item.value}</span>
    </>
  );
  return item.onClick ? (
    <button
      className="status-bar__item status-bar__item--button"
      onClick={item.onClick}
      title={item.title}
      type="button"
    >
      {content}
    </button>
  ) : (
    <div className="status-bar__item" title={item.title}>
      {content}
    </div>
  );
}

// Transient app status. Info messages fade after a timeout; errors persist
// until the next status replaces them.
function StatusBarMessage({ message }: { message: StatusMessage }) {
  const { text } = message;
  const clears = statusMessageClears(message);
  const [expiredText, setExpiredText] = useState<string | null>(null);

  // Keyed on the text rather than the message object so frequent app
  // re-renders (e.g. during playback) do not restart the timer.
  useEffect(() => {
    if (!clears) {
      return;
    }
    const timer = window.setTimeout(
      () => setExpiredText(text),
      STATUS_MESSAGE_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [text, clears]);

  const hidden = clears && expiredText === text;

  return (
    <div
      aria-live="polite"
      className={`status-bar__message status-bar__message--${message.tone}${
        hidden ? " status-bar__message--hidden" : ""
      }`}
      role="status"
      title={text}
    >
      {text}
    </div>
  );
}

// Compact single-line bar docked at the bottom of the app shell. Memoized so
// app re-renders during playback skip it unless its items or message change.
export const StatusBar = memo(function StatusBar({
  items,
  message,
}: {
  items: readonly StatusItem[];
  message?: StatusMessage;
}) {
  const { start, end } = partitionStatusItems(items);
  return (
    <footer className="status-bar">
      <div className="status-bar__group">
        {start.map((item) => (
          <StatusBarItem item={item} key={item.id} />
        ))}
      </div>
      {message?.text ? <StatusBarMessage message={message} /> : null}
      <div className="status-bar__group status-bar__group--end">
        {end.map((item) => (
          <StatusBarItem item={item} key={item.id} />
        ))}
      </div>
    </footer>
  );
});
