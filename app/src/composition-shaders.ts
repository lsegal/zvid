// Shaders the compositor draws layers and FX clip results with.

// The layer shader, with or without a Mask: a masked layer's alpha is
// multiplied by the alpha its Target drew at the same framebuffer pixel, in
// the `uMaskSize` corner of `uMask` (see TextureRegion), or by 1 minus it
// when `uMaskInvert` is 1 (Subtractive), and so is its color when
// `uMaskPremultiplied` is 1.
function compositeFragmentSource(masked: boolean) {
  return `
  ${masked ? "#define LAYER_MASK" : ""}
  precision mediump float;
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  #define MASK_PRECISION highp
  #else
  #define MASK_PRECISION mediump
  #endif

  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform float uOpacity;
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uSaturation;
  // The part of the texture the picture fills (see TextureRegion).
  uniform vec2 uUvScale;
  uniform vec2 uUvMax;
  #ifdef LAYER_MASK
  uniform sampler2D uMask;
  uniform MASK_PRECISION vec2 uMaskSize;
  uniform MASK_PRECISION vec2 uMaskUvScale;
  uniform MASK_PRECISION vec2 uMaskUvMax;
  uniform float uMaskInvert;
  uniform float uMaskPremultiplied;
  #endif

  void main() {
    vec4 color = texture2D(
      uTexture,
      min(vec2(vUv.x, 1.0 - vUv.y) * uUvScale, uUvMax)
    );
    color.rgb += uBrightness;
    color.rgb = (color.rgb - 0.5) * uContrast + 0.5;
    float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    color.rgb = mix(vec3(luma), color.rgb, uSaturation);
    color.a *= uOpacity;
    #ifdef LAYER_MASK
    MASK_PRECISION vec2 maskUv = gl_FragCoord.xy / uMaskSize;
    float coverage = texture2D(
      uMask,
      min(maskUv * uMaskUvScale, uMaskUvMax)
    ).a;
    float masked = mix(coverage, 1.0 - coverage, uMaskInvert);
    color *= vec4(vec3(mix(1.0, masked, uMaskPremultiplied)), masked);
    #endif
    gl_FragColor = color;
  }
`;
}

export const COMPOSITE_FRAGMENT_SOURCE = compositeFragmentSource(false);

export const MASKED_COMPOSITE_FRAGMENT_SOURCE = compositeFragmentSource(true);

export const COMPOSITE_VERTEX_SOURCE = `
  attribute vec2 aPosition;
  varying vec2 vUv;

  uniform vec2 uAxisX;
  uniform vec2 uAxisY;
  uniform vec2 uOffset;

  void main() {
    vec2 position = aPosition.x * uAxisX + aPosition.y * uAxisY + uOffset;
    gl_Position = vec4(position, 0.0, 1.0);
    vUv = aPosition * 0.5 + 0.5;
  }
`;

// Draws a quad over an FX clip's box that samples the texture at the same
// place on the canvas, so the adjusted composite replaces the original only
// inside the box, however the box is turned. With a Mask, its alpha is
// multiplied as a masked layer's is, to be blended over the original.
export const FX_MASK_VERTEX_SOURCE = `
  attribute vec2 aPosition;
  varying vec2 vUv;

  uniform vec2 uAxisX;
  uniform vec2 uAxisY;
  uniform vec2 uOffset;

  void main() {
    vec2 position = aPosition.x * uAxisX + aPosition.y * uAxisY + uOffset;
    gl_Position = vec4(position, 0.0, 1.0);
    vUv = position * 0.5 + 0.5;
  }
`;

function fxMaskFragmentSource(masked: boolean) {
  return `
  ${masked ? "#define LAYER_MASK" : ""}
  precision mediump float;
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  #define MASK_PRECISION highp
  #else
  #define MASK_PRECISION mediump
  #endif

  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform vec2 uUvScale;
  uniform vec2 uUvMax;
  #ifdef LAYER_MASK
  uniform sampler2D uMask;
  uniform MASK_PRECISION vec2 uMaskSize;
  uniform MASK_PRECISION vec2 uMaskUvScale;
  uniform MASK_PRECISION vec2 uMaskUvMax;
  uniform float uMaskInvert;
  #endif

  void main() {
    vec4 color = texture2D(uTexture, min(vUv * uUvScale, uUvMax));
    #ifdef LAYER_MASK
    MASK_PRECISION vec2 maskUv = gl_FragCoord.xy / uMaskSize;
    float coverage = texture2D(
      uMask,
      min(maskUv * uMaskUvScale, uMaskUvMax)
    ).a;
    color.a *= mix(coverage, 1.0 - coverage, uMaskInvert);
    #endif
    gl_FragColor = color;
  }
`;
}

export const FX_MASK_FRAGMENT_SOURCE = fxMaskFragmentSource(false);

export const MASKED_FX_MASK_FRAGMENT_SOURCE = fxMaskFragmentSource(true);
