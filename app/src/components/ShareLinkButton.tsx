import { LinkIcon } from "@heroicons/react/24/solid";
import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  copyShareLink,
  SHARE_LINK_COPIED_RESET_MS,
  type ShareLinkCopyState,
  shareLinkButtonLabel,
} from "../share-link";

/**
 * Status bar button that copies the live share's invite URL. It confirms a
 * copy for a moment; when the clipboard is unavailable it opens a popover
 * with the URL selected so it can be copied by hand.
 */
export function ShareLinkButton({ url }: { url: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [copyState, setCopyState] = useState<ShareLinkCopyState>("idle");

  useEffect(() => {
    if (copyState !== "copied") {
      return;
    }
    const timer = window.setTimeout(
      () => setCopyState("idle"),
      SHARE_LINK_COPIED_RESET_MS,
    );
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function handleCopy() {
    setCopyState(await copyShareLink(url));
  }

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
              onClose={() => setCopyState("idle")}
              url={url}
            />,
            document.body,
          )
        : null}
    </>
  );
}

// Opens above the button (the status bar clips its own overflow) with the URL
// selected. Escape or a click outside closes it.
function ShareLinkFallback({
  anchorRef,
  onClose,
  url,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  url: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState<CSSProperties>({
    visibility: "hidden",
  });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    if (anchor) {
      setPosition({
        bottom: window.innerHeight - anchor.top + 6,
        left: Math.max(8, anchor.left),
      });
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [anchorRef]);

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
      <label className="share-link-fallback__label" htmlFor="share-link-url">
        Copying failed. Copy the link manually:
      </label>
      <input
        className="share-link-fallback__input"
        id="share-link-url"
        onFocus={(event) => event.currentTarget.select()}
        readOnly
        ref={inputRef}
        type="text"
        value={url}
      />
    </div>
  );
}
