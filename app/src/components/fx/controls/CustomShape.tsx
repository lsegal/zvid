import { useSyncExternalStore } from "react";
import {
  getShapeImageMedia,
  getShapeImagesVersion,
  getShapeSvgUrl,
  type ShapeImageMedia,
  shapeMediaPath,
  subscribeShapeImages,
} from "../../../fx/effects/shape/custom-mask.ts";

// Shape ▸ Custom's parts of the Shape picker: its preview, and the list of
// the session's SVG media to take the mask from.

// Re-renders when the session's SVG media change or one finishes loading.
function useShapeImages() {
  useSyncExternalStore(subscribeShapeImages, getShapeImagesVersion);
  return getShapeImageMedia();
}

// The SVG's opaque area drawn black on white, stretched over the preview as
// the mask is over the layer's box; "SVG" while there is none to show.
export function CustomShapePreview({
  mediaPath,
}: {
  mediaPath: string | undefined;
}) {
  useShapeImages();
  const url = getShapeSvgUrl(mediaPath);
  return url ? (
    <span aria-hidden="true" className="fx-shape__preview fx-shape__custom">
      <span
        className="fx-shape__custom-mask"
        style={{
          maskImage: `url("${url}")`,
          WebkitMaskImage: `url("${url}")`,
        }}
      />
    </span>
  ) : (
    <svg
      aria-hidden="true"
      className="fx-shape__preview"
      viewBox="-8 -8 116 116"
    >
      <rect fill="#fff" height="116" width="116" x="-8" y="-8" />
      <rect
        fill="none"
        height="84"
        stroke="#000"
        strokeDasharray="8 6"
        strokeWidth="4"
        width="84"
        x="8"
        y="8"
      />
      <text fontSize="26" fontWeight="700" textAnchor="middle" x="50" y="59">
        SVG
      </text>
    </svg>
  );
}

// The SVG media to pick a Custom shape's mask from.
export function CustomShapeMediaList({
  selectedPath,
  onPick,
}: {
  selectedPath: string | undefined;
  onPick: (mediaPath: string) => void;
}) {
  const media = useShapeImages();
  if (!media.length) {
    return (
      <p className="fx-shape__custom-empty">
        Import an SVG as media to use it as a shape.
      </p>
    );
  }
  return (
    <div
      aria-label="SVG media"
      className="fx-shape__custom-list"
      role="listbox"
    >
      {media.map((item: ShapeImageMedia) => {
        const path = shapeMediaPath(item);
        return (
          <button
            aria-selected={path === selectedPath}
            className="fx-shape__option"
            key={item.id}
            onClick={() => onPick(path)}
            role="option"
            title={item.name}
            type="button"
          >
            <CustomShapePreview mediaPath={path} />
            <span className="fx-shape__custom-name">{item.name}</span>
            {item.availability === "offline" ? (
              <span className="fx-shape__custom-offline">Offline</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
