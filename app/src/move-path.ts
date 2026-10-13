// The motion path a Move draws over the preview: where the clip's box
// center goes as the Move runs from its Start through its waypoints to its
// End, with every other Transform and Move held where the playhead has them.
// Each point is placed by the same Transform chain the compositor draws the
// clip with, the Move's own resolved by `resolveMoveTransform`, so the path
// matches the rendered motion exactly.
import {
  applyMatrix,
  chainTransformMatrix,
  frameBoxInCanvas,
  type LayerMove,
  type LayerTransform,
  type Matrix2D,
  type MoveSource,
  multiplyMatrix,
  type Point,
  resolveMoveTransform,
  stackTransformChain,
  type TransformMotion,
  visualTransformMatrix,
} from "./composition-transform.ts";
import {
  type PreviewEditTarget,
  type PreviewLayer,
  resolveLayerSpace,
  type Size,
} from "./preview-edit.ts";

// Path samples per leg between two points: enough for a smooth curve.
const SAMPLES_PER_LEG = 32;

export type MovePath = {
  source: MoveSource;
  // The Start, each waypoint, then the End, in canvas pixels.
  points: Point[];
  // The path in canvas pixels, and how far along it (0..1) each sample is.
  samples: Array<{ point: Point; along: number }>;
  // The matrix around the Move: a dragged point's travel is measured in its
  // input space, where the Move's positions are.
  parent: Matrix2D;
  // The surface the Move's positions are measured on.
  surface: Size;
};

// The Move whose path shows for `layer` when `target` is edited: one on the
// selected clip's own stack, else on its layer's, preferring `activeEffectId`
// and otherwise the last.
export function findPathMove(
  layer: Pick<PreviewLayer, "moves">,
  target: PreviewEditTarget,
  activeEffectId: string | undefined,
) {
  const moves = layer.moves ?? [];
  const clipMoves =
    target.clipId === undefined
      ? []
      : moves.filter((source) => source.stack === "clip");
  const candidates = clipMoves.length
    ? clipMoves
    : moves.filter((source) => source.stack === "layer");
  return (
    candidates.find((source) => source.effectId === activeEffectId) ??
    candidates.at(-1)
  );
}

function withMoveAt(
  motion: TransformMotion | undefined,
  source: MoveSource,
  transform: LayerTransform,
): TransformMotion {
  const next = { outer: [...(motion?.outer ?? [])], inner: [...(motion?.inner ?? [])] };
  next[source.slot][source.index] = transform;
  return next;
}

// The Transforms around the Move, outermost first.
function chainAroundMove(layer: PreviewLayer, source: MoveSource) {
  const motion = source.stack === "layer" ? layer.motion : layer.clipMotion;
  const transform =
    source.stack === "layer" ? layer.transform : layer.clipTransform;
  const before =
    source.slot === "outer"
      ? (motion?.outer ?? []).slice(0, source.index)
      : [
          ...(motion?.outer ?? []),
          transform,
          ...(motion?.inner ?? []).slice(0, source.index),
        ];
  return source.stack === "layer"
    ? before
    : [...stackTransformChain(layer.transform, layer.motion), ...before];
}

export function resolveMovePath(
  layer: PreviewLayer,
  source: MoveSource,
  canvas: Size,
): MovePath {
  const space = resolveLayerSpace(layer, canvas);
  const box = frameBoxInCanvas(layer.placement.frame, space.canvas);
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const motionKey = source.stack === "layer" ? "motion" : "clipMotion";
  const at = (transform: LayerTransform) =>
    applyMatrix(
      multiplyMatrix(
        space.matrix,
        visualTransformMatrix(box, space.canvas, {
          ...layer,
          [motionKey]: withMoveAt(layer[motionKey], source, transform),
        }),
      ),
      center,
    );
  const { move } = source;
  const waypoints = move.waypoints ?? [];
  // The path's shape, without the Motion curve's timing.
  const even: LayerMove = { ...move, motion: "Linear" };
  const count = SAMPLES_PER_LEG * (waypoints.length + 1);
  return {
    source,
    points: [move.start, ...waypoints, move.end].map(at),
    samples: Array.from({ length: count + 1 }, (_, index) => ({
      point: at(resolveMoveTransform(even, index / count)),
      along: index / count,
    })),
    parent: multiplyMatrix(
      space.matrix,
      chainTransformMatrix(chainAroundMove(layer, source), box, space.canvas),
    ),
    surface: space.canvas,
  };
}

// How far along `samples` (0..1) the point on it nearest `point` is, and how
// far away it is in the samples' units.
export function nearestAlongPath(
  samples: MovePath["samples"],
  point: Point,
) {
  let best = { along: 0, distance: Number.POSITIVE_INFINITY };
  for (let index = 1; index < samples.length; index += 1) {
    const from = samples[index - 1];
    const to = samples[index];
    const dx = to.point.x - from.point.x;
    const dy = to.point.y - from.point.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared > 0
        ? Math.max(
            0,
            Math.min(
              1,
              ((point.x - from.point.x) * dx + (point.y - from.point.y) * dy) /
                lengthSquared,
            ),
          )
        : 0;
    const distance = Math.hypot(
      from.point.x + t * dx - point.x,
      from.point.y + t * dy - point.y,
    );
    if (distance < best.distance) {
      best = { along: from.along + t * (to.along - from.along), distance };
    }
  }
  return best;
}
