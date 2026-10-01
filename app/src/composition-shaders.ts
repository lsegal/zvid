// Shaders the compositor draws layers and FX clip results with.

export const COMPOSITE_FRAGMENT_SOURCE = `
  precision mediump float;

  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform float uOpacity;
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uSaturation;
  // The part of the texture the picture fills (see TextureRegion).
  uniform vec2 uUvScale;
  uniform vec2 uUvMax;

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
    gl_FragColor = color;
  }
`;

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
// inside the box, however the box is turned.
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

export const FX_MASK_FRAGMENT_SOURCE = `
  precision mediump float;

  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform vec2 uUvScale;
  uniform vec2 uUvMax;

  void main() {
    gl_FragColor = texture2D(uTexture, min(vUv * uUvScale, uUvMax));
  }
`;
