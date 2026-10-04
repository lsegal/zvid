import { useRef, useState } from "react";

// biome-ignore lint/suspicious/noExplicitAny: handlers take any arguments
type Handler = (...args: any[]) => unknown;

// Stand-ins for event handlers that are recreated every render, which keep
// their identity so memoized rows taking them don't re-render. Each calls
// the handler from the latest render, so call them only from events, never
// while rendering.
export function useStableHandlers<Handlers extends Record<string, Handler>>(
  handlers: Handlers,
): Handlers {
  const latestRef = useRef(handlers);
  latestRef.current = handlers;
  const [stable] = useState(
    () =>
      Object.fromEntries(
        Object.keys(handlers).map((key) => [
          key,
          (...args: unknown[]) => latestRef.current[key](...args),
        ]),
      ) as Handlers,
  );
  return stable;
}
