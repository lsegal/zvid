import { CheckIcon, LinkIcon } from "@heroicons/react/24/solid";
import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  copyShareLink,
  SHARE_LINK_COPIED_RESET_MS,
  SHARE_LINK_ICON_COPIED_RESET_MS,
  type ShareLinkCopyState,
  shareLinkButtonLabel,
} from "../share-link";

// Copy state shared by both share link buttons: "copied" reverts to "idle"
// after resetMs, and "failed" stays until the fallback popover closes.
function useShareLinkCopy(url: string, resetMs: number, onCopied?: () => void) {
  const [copyState, setCopyState] = useState<ShareLinkCopyState>("idle");

  useEffect(() => {
    if (copyState !== "copied") {
      return;
    }
    const timer = window.setTimeout(() => setCopyState("idle"), resetMs);
    return () => window.clearTimeout(timer);
  }, [copyState, resetMs]);

  async function copy() {
    const state = await copyShareLink(url);
    setCopyState(state);
    if (state === "copied") {
      onCopied?.();
    }
  }

  return { copy, copyState, reset: () => setCopyState("idle") };
}

/**
 * Status bar button that copies the live share's invite URL. It confirms a
 * copy for a moment; when the clipboard is unavailable it opens a popover
 * with the URL selected so it can be copied by hand.
 */
export function ShareLinkButton({ url }: { url: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const {
    copy: handleCopy,
    copyState,
    reset,
  } = useShareLinkCopy(url, SHARE_LINK_COPIED_RESET_MS);

  return (
    <>
      <button
        aria-label="Copy share link"
        className={`status-share-link status-share-link--${copyState}`}
        onClick={handleCopy}
        ref={buttonRef}
        title={url}
        type="button"
      >
        <LinkIcon aria-hidden="true" className="status-share-link__icon" />
        <span aria-live="polite">{shareLinkButtonLabel(copyState)}</span>
      </button>
      {copyState === "failed" && typeof document !== "undefined"
        ? createPortal(
            <ShareLinkFallback
              anchorRef={buttonRef}
              onClose={reset}
              placement="above"
              url={url}
            />,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * Green link icon next to Stop Share in the top bar. Copies the same invite
 * URL as the status bar button, briefly swapping to a check on success and
 * opening the same manual-copy popover (below it) on failure.
 */
export function ShareLinkIconButton({
  onCopied,
  url,
}: {
  onCopied?: () => void;
  url: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const {
    copy: handleCopy,
    copyState,
    reset,
  } = useShareLinkCopy(url, SHARE_LINK_ICON_COPIED_RESET_MS, onCopied);
  const Icon = copyState === "copied" ? CheckIcon : LinkIcon;

  return (
    <>
      <button
        aria-label="Copy share link"
        className={`share-link-icon-button share-link-icon-button--${copyState}`}
        onClick={handleCopy}
        ref={buttonRef}
        title="Copy share link"
        type="button"
      >
        <Icon aria-hidden="true" className="share-link-icon-button__icon" />
      </button>
      {copyState === "failed" && typeof document !== "undefined"
        ? createPortal(
            <ShareLinkFallback
              anchorRef={buttonRef}
              onClose={reset}
              placement="below"
              url={url}
            />,
            document.body,
          )
        : null}
    </>
  );
}

// Opens above the status bar button (the status bar clips its own overflow)
// or below the top bar icon, with the URL selected. Escape or a click outside
// closes it.
function ShareLinkFallback({
  anchorRef,
  onClose,
  placement,
  url,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  placement: "above" | "below";
  url: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  // The button is already mounted, so the popover can be placed on first render.
  const [position] = useState<CSSProperties>(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    if (!anchor) {
      return placement === "above"
        ? { bottom: 32, left: 8 }
        : { top: 64, right: 8 };
    }
    return placement === "above"
      ? {
          bottom: window.innerHeight - anchor.top + 6,
          left: Math.max(8, anchor.left),
        }
      : {
          top: anchor.bottom + 6,
          right: Math.max(8, window.innerWidth - anchor.right),
        };
  });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !anchorRef.current?.contains(target)
      ) {
        onCloseRef.current();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        anchorRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef]);

  return (
    <div
      aria-label="Share link"
      className="share-link-fallback"
      ref={rootRef}
      role="dialog"
      style={position}
    >
      <label className="share-link-fallback__label" htmlFor={inputId}>
        Copying failed. Copy the link manually:
      </label>
      <input
        className="share-link-fallback__input"
        id={inputId}
        onFocus={(event) => event.currentTarget.select()}
        readOnly
        ref={inputRef}
        type="text"
        value={url}
      />
    </div>
  );
}
