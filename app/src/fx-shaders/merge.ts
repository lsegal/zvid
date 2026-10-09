import type { CompiledPass } from "./chain.ts";
import {
  FULLSCREEN_VERTEX_SOURCE,
  finishProgram,
  isProgramReady,
  type PendingProgram,
  startProgram,
} from "./gl.ts";
import type { EffectPass, EffectUniformLocations } from "./types.ts";

// A run of passes the chain draws as one: a pass without stages, then the
// per-pixel passes straight after it (see `isPerPixelPass`). Each of those
// reads the color the one before it drew at the same pixel, so they can all
// run in the first pass's shader instead of a full-frame pass each.

// A pass reading its input at the pixel it draws.
const INPUT_AT_PIXEL = /\btexture2D\s*\(\s*uTex\s*,\s*vUv\s*\)/g;

// Merged programs kept; runs of passes past this draw unmerged.
export const MAX_MERGED_PROGRAMS = 64;

function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// Whether `pass`'s shader can be pasted into another: no stages, and no
// preprocessor lines, which must start a shader. A view-only pass is never
// drawn into the picture, so it is never merged either.
export function canMergePass(pass: EffectPass) {
  return (
    !pass.analyzes &&
    !pass.stages?.length &&
    !/^\s*#/m.test(pass.fragmentSource)
  );
}

const perPixelPasses = new WeakMap<EffectPass, boolean>();

// Whether `pass` reads its input only at the pixel it draws, so it can run
// after the pass before it in that pass's shader.
export function isPerPixelPass(pass: EffectPass) {
  let perPixel = perPixelPasses.get(pass);
  if (perPixel === undefined) {
    const body = stripComments(pass.fragmentSource)
      .replace(INPUT_AT_PIXEL, "")
      .replace(/\buniform\s+sampler2D\s+uTex\s*;/, "");
    perPixel =
      canMergePass(pass) &&
      !/\b(uTex|discard|gl_FragCoord)\b/.test(body) &&
      pass.fragmentSource.search(INPUT_AT_PIXEL) >= 0;
    perPixelPasses.set(pass, perPixel);
  }
  return perPixel;
}

const QUALIFIERS = new Set([
  "uniform",
  "const",
  "attribute",
  "invariant",
  "highp",
  "mediump",
  "lowp",
]);

// The names a global statement such as `uniform float uLow, uHigh` or
// `const vec2 A = vec2(1.0, 2.0)` declares.
function declaredNames(statement: string) {
  let text = statement.trim();
  if (/^(precision|varying)\b/.test(text)) {
    return [];
  }
  const call = /^[\w\s]*?(\w+)\s*\(/.exec(text);
  if (call && !text.includes("=")) {
    // A function prototype.
    return [call[1]];
  }
  while (/\([^()]*\)/.test(text)) {
    text = text.replace(/\([^()]*\)/g, "");
  }
  const words = text
    .replace(/\[[^\]]*\]/g, "")
    .replace(/=[^,]*/g, "")
    .split(/[\s,]+/)
    .filter(Boolean);
  while (words.length && QUALIFIERS.has(words[0])) {
    words.shift();
  }
  // The first word left is the type.
  return words.slice(1);
}

// The functions, uniforms and constants `source` declares outside its
// functions.
function globalNames(source: string) {
  const names: string[] = [];
  let depth = 0;
  let statement = "";
  for (const char of source) {
    if (char === "{") {
      if (depth === 0) {
        const header = /(\w+)\s*\([^()]*\)\s*$/.exec(statement);
        if (header) {
          names.push(header[1]);
        }
        statement = "";
      }
      depth++;
    } else if (char === "}") {
      depth--;
    } else if (depth === 0) {
      if (char === ";") {
        names.push(...declaredNames(statement));
        statement = "";
      } else {
        statement += char;
      }
    }
  }
  return names;
}

export type MergedSource = {
  // Fragment shader body, reading the first pass's input through `uTex`.
  fragmentSource: string;
  // Each pass's uniforms, by the name it gives them, as named in the shader.
  uniforms: Array<Record<string, string>>;
};

// One shader running `passes` in order. Each pass's globals get a prefix of
// its own, so passes declaring the same names, or the same pass twice, don't
// collide. Between passes the color is clamped and rounded as an 8-bit
// target would store it, so the result matches drawing them one by one.
export function mergedSource(passes: readonly EffectPass[]): MergedSource {
  const uniforms: Array<Record<string, string>> = [];
  const parts = passes.map((pass, index) => {
    const prefix = `fx${index}_`;
    let source = stripComments(pass.fragmentSource)
      .replace(/\bprecision\s+\w+\s+\w+\s*;/g, "")
      .replace(/\bvarying\s+[^;]*;/g, "");
    if (index > 0) {
      source = source.replace(INPUT_AT_PIXEL, "fxInput");
    }
    for (const name of new Set(globalNames(source))) {
      // The first pass reads the chain's input as is.
      if (index === 0 && name === "uTex") {
        continue;
      }
      source = source.replace(
        new RegExp(`(?<![.\\w])${name}\\b`, "g"),
        prefix + name,
      );
    }
    uniforms.push(
      Object.fromEntries(pass.uniforms.map((name) => [name, prefix + name])),
    );
    return source.replace(/\bgl_FragColor\b/g, "fxColor");
  });
  const calls = passes.map((_, index) =>
    index === 0
      ? "  fx0_main();"
      : `  fxInput = fxStored(fxColor);\n  fx${index}_main();`,
  );
  const fragmentSource = `varying vec2 vUv;
vec4 fxInput;
vec4 fxColor;
vec4 fxStored(vec4 color) {
  return floor(clamp(color, 0.0, 1.0) * 255.0 + 0.5) / 255.0;
}
${parts.join("\n")}
void main() {
${calls.join("\n")}
  gl_FragColor = fxColor;
}
`;
  return { fragmentSource, uniforms };
}

let nextPassId = 1;
const passIds = new WeakMap<EffectPass, number>();

function passId(pass: EffectPass) {
  let id = passIds.get(pass);
  if (id === undefined) {
    id = nextPassId++;
    passIds.set(pass, id);
  }
  return id;
}

// A merged program the driver is still compiling.
type PendingMerge = {
  pending: PendingProgram;
  passes: EffectPass[];
  source: MergedSource;
};

// Merged programs for one WebGL context, by the passes they run. A run seen
// for the first time is handed to the driver and drawn unmerged until its
// program is ready, so a new combination never stalls a frame compiling.
// Programs that fail to compile leave their runs unmerged.
export class MergedPrograms {
  private readonly gl: WebGLRenderingContext;
  private readonly parallel: KHR_parallel_shader_compile | null;
  // `programSource` from the chain, adding its header to a shader body.
  private readonly programSource: (fragmentSource: string) => string;
  private readonly locate: (
    program: WebGLProgram,
  ) => Omit<CompiledPass, "pass" | "stages">;
  private readonly programs = new Map<
    string,
    PendingMerge | CompiledPass | null
  >();

  constructor(
    gl: WebGLRenderingContext,
    parallel: KHR_parallel_shader_compile | null,
    programSource: (fragmentSource: string) => string,
    locate: (program: WebGLProgram) => Omit<CompiledPass, "pass" | "stages">,
  ) {
    this.gl = gl;
    this.parallel = parallel;
    this.programSource = programSource;
    this.locate = locate;
  }

  // The program running `passes` in one draw, or null while it compiles,
  // or when it can't be had.
  get(passes: EffectPass[]) {
    const key = passes.map(passId).join(",");
    const entry = this.programs.get(key);
    if (entry === undefined) {
      if (this.programs.size < MAX_MERGED_PROGRAMS) {
        this.start(key, passes);
      }
      return null;
    }
    if (entry === null || !("pending" in entry)) {
      return entry;
    }
    if (
      this.parallel &&
      !isProgramReady(this.gl, this.parallel, entry.pending)
    ) {
      return null;
    }
    return this.finish(key, entry);
  }

  dispose() {
    for (const entry of this.programs.values()) {
      if (entry && "pending" in entry) {
        this.gl.deleteShader(entry.pending.vertexShader);
        this.gl.deleteShader(entry.pending.fragmentShader);
        this.gl.deleteProgram(entry.pending.program);
      } else if (entry) {
        this.gl.deleteProgram(entry.program);
      }
    }
    this.programs.clear();
  }

  private start(key: string, passes: EffectPass[]) {
    const source = mergedSource(passes);
    try {
      const pending = startProgram(
        this.gl,
        FULLSCREEN_VERTEX_SOURCE,
        this.programSource(source.fragmentSource),
      );
      this.programs.set(key, { pending, passes, source });
    } catch (error) {
      this.fail(key, passes, error);
    }
  }

  private finish(key: string, { pending, passes, source }: PendingMerge) {
    let program: WebGLProgram;
    try {
      program = finishProgram(this.gl, pending);
    } catch (error) {
      this.fail(key, passes, error);
      return null;
    }
    const parts = passes.map((pass, index) => {
      const locations: EffectUniformLocations = {};
      for (const [name, merged] of Object.entries(source.uniforms[index])) {
        locations[name] = this.gl.getUniformLocation(program, merged);
      }
      return { pass, locations };
    });
    const compiled: CompiledPass = {
      ...this.locate(program),
      pass: {
        effectName: passes.map((pass) => pass.effectName).join(" + "),
        fragmentSource: source.fragmentSource,
        uniforms: [],
        setUniforms() {},
      },
      stages: [],
      parts,
    };
    this.programs.set(key, compiled);
    return compiled;
  }

  private fail(key: string, passes: EffectPass[], error: unknown) {
    const names = passes.map((pass) => pass.effectName).join(" + ");
    console.warn(`Merged effects "${names}" failed to compile.`, error);
    this.programs.set(key, null);
  }
}
