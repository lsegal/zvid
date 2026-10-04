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

// A program whose shaders were handed to the driver and linked without
// waiting to hear whether they compiled, so the driver can work on it in the
// background until `finishProgram` asks.
export type PendingProgram = {
  program: WebGLProgram;
  vertexShader: WebGLShader;
  fragmentShader: WebGLShader;
};

function compileShader(
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
  return shader;
}

export function startProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
): PendingProgram {
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
  return { program, vertexShader, fragmentShader };
}

// Whether the driver has finished `pending`, so `finishProgram` won't wait
// on it. Without KHR_parallel_shader_compile there is no way to ask, and
// this is always false.
export function isProgramReady(
  gl: WebGLRenderingContext,
  parallel: KHR_parallel_shader_compile | null,
  pending: PendingProgram,
) {
  return Boolean(
    parallel &&
      gl.getProgramParameter(pending.program, parallel.COMPLETION_STATUS_KHR),
  );
}

// Checks how `pending` compiled and linked, waiting for the driver if it
// hasn't finished. Returns the program, or throws with the driver's log.
export function finishProgram(
  gl: WebGLRenderingContext,
  { program, vertexShader, fragmentShader }: PendingProgram,
) {
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
  let message = "";
  if (!linked) {
    for (const shader of [vertexShader, fragmentShader]) {
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        message =
          gl.getShaderInfoLog(shader) ?? "Unknown WebGL shader compile error.";
        break;
      }
    }
    message ||= gl.getProgramInfoLog(program) ?? "Unknown WebGL link error.";
  }

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!linked) {
    gl.deleteProgram(program);
    throw new Error(message);
  }

  return program;
}

export function linkProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
) {
  return finishProgram(gl, startProgram(gl, vertexSource, fragmentSource));
}
