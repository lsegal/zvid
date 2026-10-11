import { useEffect, useState } from "react";

// How long a closing sheet stays up while it slides away (the exit
// animations in mobile-shell.css).
export const SHEET_EXIT_MS = 200;

export function prefersReducedMotion() {
  return (
    typeof window === "undefined" ||
    !window.matchMedia ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Keeps a sheet mounted for its exit animation once `open` turns false:
// `closing` is true until it's gone, and `key` changes each time it opens
// again, so a sheet reopened mid-exit starts over. With reduced motion, or
// without matchMedia (tests), it goes at once.
export function useSheetPresence(open: boolean) {
  const [shown, setShown] = useState(open);
  const [key, setKey] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setShown(true);
      setKey((current) => current + 1);
    } else if (prefersReducedMotion()) {
      setShown(false);
    }
  }

  useEffect(() => {
    if (open || !shown) {
      return;
    }
    const timer = window.setTimeout(() => setShown(false), SHEET_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, shown]);

  return { present: open || shown, closing: !open && shown, key };
}
