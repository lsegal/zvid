import { type RefObject, useCallback, useEffect, useRef } from "react";
import { resolvePreviewPixelRatio } from "../composition-canvas.ts";

type Size = { width: number; height: number };

// The preview canvas's pixel ratio to the output, kept in step with the
// panel it fills and the display's pixel density. Reading it is cheap enough
// for every frame; `onChange` runs when the panel or the density changes,
// so a paused preview can redraw at the new size.
export function usePreviewPixelRatio(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  output: Size,
  onChange: () => void,
) {
  const outputRef = useRef(output);
  outputRef.current = output;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const panelRef = useRef<Size>({ width: 0, height: 0 });
  const deviceRatioRef = useRef(window.devicePixelRatio || 1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    panelRef.current = {
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    };
    const observer = new ResizeObserver((entries) => {
      const box = entries.at(-1)?.contentRect;
      if (!box) {
        return;
      }
      panelRef.current = { width: box.width, height: box.height };
      onChangeRef.current();
    });
    observer.observe(canvas);

    // A resolution query only matches one density, so it is replaced each
    // time the density changes, as when the window moves between displays.
    let query: MediaQueryList | undefined;
    const watchDensity = () => {
      deviceRatioRef.current = window.devicePixelRatio || 1;
      query = window.matchMedia?.(
        `(resolution: ${deviceRatioRef.current}dppx)`,
      );
      query?.addEventListener("change", onDensityChange, { once: true });
    };
    const onDensityChange = () => {
      watchDensity();
      onChangeRef.current();
    };
    watchDensity();

    return () => {
      observer.disconnect();
      query?.removeEventListener("change", onDensityChange);
    };
  }, [canvasRef]);

  return useCallback(
    () =>
      resolvePreviewPixelRatio(
        outputRef.current,
        panelRef.current,
        deviceRatioRef.current,
      ),
    [],
  );
}
