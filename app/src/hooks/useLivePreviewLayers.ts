import { useEffect, useState } from "react";
import type { PlayheadSignal } from "../playhead-signal.ts";
import type { PreviewLayer } from "../preview-edit.ts";

// What the overlay draws for the selected layer: its placement, Transforms,
// motion and corners. Equal keys draw the same box and handles.
export function selectedPreviewLayerKey(
  layers: readonly PreviewLayer[],
  selectedLaneId: string | undefined,
) {
  const selected = layers.find((layer) => layer.laneId === selectedLaneId);
  return selected ? JSON.stringify(selected) : "";
}

// Calls `onChange` with the layers at the live playhead each time the
// selected layer's box moves away from what is shown, starting from
// `layers`. Returns the unsubscribe.
export function followSelectedPreviewLayer({
  layers,
  resolveLayersAt,
  playheadSignal,
  selectedLaneId,
  onChange,
}: {
  layers: readonly PreviewLayer[];
  resolveLayersAt: (playheadQ: number) => readonly PreviewLayer[];
  playheadSignal: PlayheadSignal;
  selectedLaneId: string;
  onChange: (layers: readonly PreviewLayer[]) => void;
}) {
  let shownKey = selectedPreviewLayerKey(layers, selectedLaneId);
  const follow = () => {
    const next = resolveLayersAt(playheadSignal.get());
    const nextKey = selectedPreviewLayerKey(next, selectedLaneId);
    if (nextKey === shownKey) {
      return;
    }

    shownKey = nextKey;
    onChange(next);
  };
  follow();
  return playheadSignal.subscribe(follow);
}

// The preview layers with the selected one where the live playhead puts it.
// The playhead is committed to React state only now and then during
// playback and scrubbing, while the compositor draws every frame from the
// signal, so the overlay resolves the layers at the signal on each move and
// re-renders only when the selected layer's box changes. Nothing is resolved
// per frame while no layer is selected.
export function useLivePreviewLayers({
  layers,
  resolveLayersAt,
  playheadSignal,
  selectedLaneId,
}: {
  layers: readonly PreviewLayer[];
  resolveLayersAt: (playheadQ: number) => readonly PreviewLayer[];
  playheadSignal: PlayheadSignal;
  selectedLaneId: string | undefined;
}) {
  // The live layers, and the committed layers they were resolved against,
  // so a new commit or edit replaces them at once.
  const [live, setLive] = useState<{
    from: readonly PreviewLayer[];
    layers: readonly PreviewLayer[];
  }>();

  useEffect(() => {
    if (selectedLaneId === undefined) {
      return;
    }

    return followSelectedPreviewLayer({
      layers,
      resolveLayersAt,
      playheadSignal,
      selectedLaneId,
      onChange: (next) => setLive({ from: layers, layers: next }),
    });
  }, [layers, playheadSignal, resolveLayersAt, selectedLaneId]);

  return live?.from === layers && selectedLaneId !== undefined
    ? live.layers
    : layers;
}
