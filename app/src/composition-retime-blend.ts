// Draws a Retime's Blend: a clip's source frame crossfaded toward the next
// one (see fx/effects/retime/retime.ts), into a target of its own, which the
// clip then draws in place of its frame.
import type { RetimeBlend } from "./composition-clip-timing.ts";
import type { WebGlResources } from "./composition-draw.ts";
import {
  type MediaSource,
  uploadMediaTexture,
} from "./composition-textures.ts";
import type { TransitionSettings } from "./fx/effects/transition/transition.ts";
import { type TextureRegion, wholeTexture } from "./fx-shaders/targets.ts";

// The arrangement-target pool the blended frames are drawn into. Orders
// nest from depth 0 up, so this one is never in use by an arrangement, and
// each blended frame is drawn into its layer before the next is made.
const BLEND_TARGET_DEPTH = -1;

// Blend is a Dissolve between the two frames, `weight` of the way through.
function dissolveAt(weight: number): TransitionSettings {
  return {
    type: "Dissolve",
    direction: [1, 0],
    softness: 0,
    irisIn: false,
    vertical: false,
    count: 1,
    origin: [0.5, 0.5],
    progress: weight,
  };
}

/**
 * The picture `entry` draws: `frame`, its own uploaded frame, or, while a
 * Retime blends it, that frame crossfaded toward the next one, drawn from
 * `mediaRefs`' blend element or the media's frame at the blend's time. The
 * frame alone stands in until the next one has loaded.
 */
export function retimeBlendedTexture(
  resources: WebGlResources,
  entry: MediaSource & { blend?: RetimeBlend },
  mediaRefs: ReadonlyMap<string, HTMLMediaElement>,
  frame: { texture: WebGLTexture; width: number; height: number },
): TextureRegion {
  const own = wholeTexture(frame.texture);
  const { blend } = entry;
  if (!blend || blend.weight <= 0) {
    return own;
  }
  const next = uploadMediaTexture(
    resources,
    { ...entry, sourceKey: blend.sourceKey, mediaTime: blend.mediaTime },
    mediaRefs.get(blend.sourceKey),
    frame,
  );
  if (!next) {
    return own;
  }
  const width = Math.max(1, Math.round(frame.width));
  const height = Math.max(1, Math.round(frame.height));
  const target = resources.effectChain.getArrangementTarget(
    BLEND_TARGET_DEPTH,
    width,
    height,
  );
  resources.transitions.draw(
    target.framebuffer,
    width,
    height,
    own,
    wholeTexture(next.texture),
    dissolveAt(blend.weight),
  );
  return target.region;
}
