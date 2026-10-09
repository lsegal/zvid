// Pooled render targets for the effect chain, and the regions of them a
// picture fills.

// Pooled targets are allocated with sides rounded up to a multiple of this,
// so a slot whose size animates reuses a few targets rather than
// allocating new ones every frame.
export const TARGET_SIZE_BUCKET = 64;

// Pooled sets of targets kept for reuse; the least recently used is freed
// past this.
export const MAX_POOLED_TARGETS = 8;

export type RenderTarget = {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
};

// A texture and the part of it a picture fills: `uvScale` of it from
// texture coordinate 0, sampled no further than `uvMax`, the centers of its
// last texels. A whole texture has both at 1.
export type TextureRegion = {
  texture: WebGLTexture;
  uvScale: [number, number];
  uvMax: [number, number];
};

export function wholeTexture(texture: WebGLTexture): TextureRegion {
  return { texture, uvScale: [1, 1], uvMax: [1, 1] };
}

// The `width` × `height` corner of `target`.
export function targetRegion(
  target: RenderTarget,
  width: number,
  height: number,
): TextureRegion {
  const axis = (used: number, size: number) =>
    used >= size ? 1 : (used - 0.5) / size;
  return {
    texture: target.texture,
    uvScale: [width / target.width, height / target.height],
    uvMax: [axis(width, target.width), axis(height, target.height)],
  };
}

// A pooled target's side for a picture `size` pixels long.
export function bucketTargetSize(
  size: number,
  maxSize: number,
  bucket = TARGET_SIZE_BUCKET,
) {
  const whole = Math.max(1, Math.ceil(size));
  return Math.max(whole, Math.min(maxSize, Math.ceil(whole / bucket) * bucket));
}

// Up to MAX_POOLED_TARGETS sets of same-sized targets, the most recently
// used last. A request reuses the smallest set with room for its picture,
// so a slot shrinking and growing again keeps drawing into the same few
// targets, and the least recently used set is freed past the limit.
export class TargetPool {
  private sets: RenderTarget[][] = [];
  private readonly release: (set: RenderTarget[]) => void;

  constructor(release: (set: RenderTarget[]) => void) {
    this.release = release;
  }

  get(fits: (set: RenderTarget[]) => boolean, create: () => RenderTarget[]) {
    const area = (set: RenderTarget[]) => set[0].width * set[0].height;
    let best = -1;
    for (const [index, set] of this.sets.entries()) {
      if (fits(set) && (best < 0 || area(set) < area(this.sets[best]))) {
        best = index;
      }
    }
    const set = best < 0 ? create() : this.sets.splice(best, 1)[0];
    this.sets.push(set);
    while (this.sets.length > MAX_POOLED_TARGETS) {
      this.release(this.sets.shift() as RenderTarget[]);
    }
    return set;
  }

  clear() {
    for (const set of this.sets) {
      this.release(set);
    }
    this.sets = [];
  }
}
