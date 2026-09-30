import {
  BackwardIcon,
  ForwardIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PauseIcon,
  PlayIcon,
} from "@heroicons/react/24/solid";
import {
  formatZoomFactor,
  sliderPositionToZoom,
  stepZoom,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SLIDER_STEP,
  zoomFillFraction,
  zoomToSliderPosition,
} from "../../zoom";
import { WandIcon } from "../WandIcon";

type TransportBarProps = {
  resolvedZoom: number;
  setZoomValue: (label: string, nextZoom: number) => void;
  updateZoomDraft: (nextZoom: number | null) => void;
  flushZoomDraft: (label?: string) => void;
  isPlaying: boolean;
  isExporting: boolean;
  jumpPlayhead: (bars: number) => void;
  onTransportToggle: () => void;
  onRandomize: () => void;
};

// The zoom control and the transport buttons below the timeline.
export function TransportBar({
  resolvedZoom,
  setZoomValue,
  updateZoomDraft,
  flushZoomDraft,
  isPlaying,
  isExporting,
  jumpPlayhead,
  onTransportToggle,
  onRandomize,
}: TransportBarProps) {
  return (
    <div className="transport-bar">
      <div className="zoom-control">
        <span className="zoom-control__label">Zoom</span>
        <button
          aria-label="Zoom out"
          className="zoom-control__button"
          disabled={resolvedZoom <= ZOOM_MIN}
          onClick={() => setZoomValue("Zoom out", stepZoom(resolvedZoom, -1))}
          title="Zoom out"
          type="button"
        >
          <MagnifyingGlassMinusIcon aria-hidden="true" />
        </button>
        <input
          aria-label="Timeline zoom"
          aria-valuetext={formatZoomFactor(resolvedZoom)}
          className="zoom-control__slider"
          data-zoom={resolvedZoom}
          max={1}
          min={0}
          onBlur={() => flushZoomDraft()}
          onChange={(event) =>
            updateZoomDraft(sliderPositionToZoom(Number(event.target.value)))
          }
          onKeyUp={() => flushZoomDraft()}
          onPointerUp={() => flushZoomDraft()}
          step={ZOOM_SLIDER_STEP}
          style={{
            ["--zoom-fill" as string]: `${zoomFillFraction(resolvedZoom) * 100}%`,
          }}
          type="range"
          value={zoomToSliderPosition(resolvedZoom)}
        />
        <button
          aria-label="Zoom in"
          className="zoom-control__button"
          disabled={resolvedZoom >= ZOOM_MAX}
          onClick={() => setZoomValue("Zoom in", stepZoom(resolvedZoom, 1))}
          title="Zoom in"
          type="button"
        >
          <MagnifyingGlassPlusIcon aria-hidden="true" />
        </button>
        <button
          aria-label={`Zoom ${formatZoomFactor(resolvedZoom)}, reset to ${formatZoomFactor(ZOOM_DEFAULT)}`}
          className="zoom-control__readout"
          onClick={() => setZoomValue("Reset zoom", ZOOM_DEFAULT)}
          title="Reset zoom to 100%"
          type="button"
        >
          {formatZoomFactor(resolvedZoom)}
        </button>
      </div>

      <div className="transport-cluster">
        <button
          aria-label="Jump back one bar"
          className="transport-button transport-button--skip-start"
          onClick={() => jumpPlayhead(-1)}
          title="Jump back one bar"
          type="button"
        >
          <BackwardIcon aria-hidden="true" />
        </button>
        <button
          aria-label="Jump back half a bar"
          className="transport-button"
          onClick={() => jumpPlayhead(-0.5)}
          title="Jump back half a bar"
          type="button"
        >
          <BackwardIcon aria-hidden="true" />
        </button>
        <button
          aria-label={isPlaying ? "Pause playback" : "Play timeline"}
          className="transport-button transport-button--primary"
          onClick={onTransportToggle}
          title={isPlaying ? "Pause playback" : "Play timeline"}
          type="button"
        >
          {isPlaying ? (
            <PauseIcon aria-hidden="true" />
          ) : (
            <PlayIcon aria-hidden="true" />
          )}
        </button>
        <button
          aria-label="Jump forward half a bar"
          className="transport-button"
          onClick={() => jumpPlayhead(0.5)}
          title="Jump forward half a bar"
          type="button"
        >
          <ForwardIcon aria-hidden="true" />
        </button>
        <button
          aria-label="Jump forward one bar"
          className="transport-button transport-button--skip-end"
          onClick={() => jumpPlayhead(1)}
          title="Jump forward one bar"
          type="button"
        >
          <ForwardIcon aria-hidden="true" />
        </button>
        <button
          aria-label="Randomize arrangement"
          className="transport-button transport-button--wand"
          disabled={isExporting}
          onClick={onRandomize}
          title="Replace the arrangement with randomized selections"
          type="button"
        >
          <WandIcon />
        </button>
      </div>
    </div>
  );
}
