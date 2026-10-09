// Texture units for textures a pass binds itself, such as Shape ▸ Custom's
// masks and LUTs. They are the top units, past those the chain binds its
// stage pictures to. Each sampler gets the next of them in turn, so the
// samplers of one merged program, up to four of them, never share one.
const EFFECT_TEXTURE_UNITS = [7, 6, 5, 4];
const units = new WeakMap<WebGLUniformLocation, number>();
let nextUnit = 0;

export function effectTextureUnit(location: WebGLUniformLocation) {
  let unit = units.get(location);
  if (unit === undefined) {
    unit = EFFECT_TEXTURE_UNITS[nextUnit];
    nextUnit = (nextUnit + 1) % EFFECT_TEXTURE_UNITS.length;
    units.set(location, unit);
  }
  return unit;
}
