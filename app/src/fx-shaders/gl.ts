// Every program binds its quad vertices to this attribute slot so the shared
// position buffer works without re-pointing it when switching programs.
export const POSITION_ATTRIBUTE_LOCATION = 0;

export const FULLSCREEN_VERTEX_SOURCE = `
  attribute vec2 aPosition;
  varying vec2 vUv;

  void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

export function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to allocate WebGL shader.");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message =
      gl.getShaderInfoLog(shader) ?? "Unknown WebGL shader compile error.";
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

export function linkProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  let fragmentShader: WebGLShader;
  try {
    fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  } catch (error) {
    gl.deleteShader(vertexShader);
    throw error;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error("Failed to allocate WebGL program.");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.bindAttribLocation(program, POSITION_ATTRIBUTE_LOCATION, "aPosition");
  gl.linkProgram(program);

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message =
      gl.getProgramInfoLog(program) ?? "Unknown WebGL link error.";
    gl.deleteProgram(program);
    throw new Error(message);
  }

  return program;
}
