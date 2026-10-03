/*
*  proof — the stack runner: renders a recipe's stack of edit tools over a photo.
*
*  Its ping-pong structure (each pass reads the previous pass's texture and draws into a fresh
*  one) follows mini-gl's runFilter, mini-gl src/minigl.js at commit 28238857 (MIT, Copyright (c)
*  2025 xdadda, derived from glfx.js, MIT, Copyright (C) 2011 by Evan Wallace). See
*  frontend/src/pipeline/LICENSES.md. The rest is proof's.
*
*  Contract (AGENTS.md "Frontend pipeline conventions"):
*   - the runner owns the GL context, every texture, and every program. Ops get a PassContext,
*     never the raw context's resources;
*   - an op is a pure function (input texture, params) -> output texture. Each multi-pass op
*     borrows scratch textures from the pool and gives back the ones it doesn't return;
*   - the preview and the export run exactly the same ops. Only the source and its size differ.
*/
import { createContext, forgetContext, PipelineUnsupported, Program, Texture } from "./gl.js";
import { GLSL_LIBRARY } from "./color.js";
import { TOOLS } from "./ops/index.js";

export { PipelineUnsupported };

const HEADER = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
out vec4 outColor;
${GLSL_LIBRARY}
`;

// Source photo (SRGB8, sampled as linear) -> working texture (RGBA16F, linear).
const DECODE = `
uniform sampler2D u_image;
void main() { outColor = vec4(texture(u_image, v_uv).rgb, 1.0); }`;

// Working texture -> 8-bit sRGB, for the screen and for readback alike, so what's shown is what's
// saved. Out-of-range and NaN values are clamped here, at the one place output is quantised. A
// tiny dither (under half a code value) breaks up banding in smooth gradients when 16-bit
// precision drops to 8 bits. It can't move an exactly representable input value, so an untouched
// photo stays bit-identical.
const ENCODE = `
uniform sampler2D u_image;
uniform float u_flip;
float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
void main() {
  vec2 uv = vec2(v_uv.x, u_flip > 0.5 ? 1.0 - v_uv.y : v_uv.y);
  vec3 c = texture(u_image, uv).rgb;
  c = vec3(isnan(c.r) ? 0.0 : c.r, isnan(c.g) ? 0.0 : c.g, isnan(c.b) ? 0.0 : c.b);
  vec3 encoded = srgbEncode(clamp(c, 0.0, 1.0));
  float noise = (hash(gl_FragCoord.xy) - 0.5) * (0.9 / 255.0);
  outColor = vec4(clamp(encoded + noise, 0.0, 1.0), 1.0);
}`;

// 2x2 box average: one bilinear tap at the shared corner of each 2x2 block of the source.
const HALVE = `
uniform sampler2D u_image;
void main() { outColor = texture(u_image, v_uv); }`;

const GAUSSIAN = `
uniform sampler2D u_image;
uniform vec2 u_step;          // one texel along the blur direction
uniform float u_radius;       // taps each side
uniform float u_weights[65];  // weights[0] is the centre
void main() {
  vec4 sum = texture(u_image, v_uv) * u_weights[0];
  for (int i = 1; i <= 64; i++) {
    if (float(i) > u_radius) break;
    float w = u_weights[i];
    sum += (texture(u_image, v_uv + u_step * float(i)) + texture(u_image, v_uv - u_step * float(i))) * w;
  }
  outColor = sum;
}`;

const BOX = `
uniform sampler2D u_image;
uniform vec2 u_step;
uniform float u_radius;
void main() {
  vec4 sum = texture(u_image, v_uv);
  for (int i = 1; i <= 64; i++) {
    if (float(i) > u_radius) break;
    sum += texture(u_image, v_uv + u_step * float(i)) + texture(u_image, v_uv - u_step * float(i));
  }
  outColor = sum / (2.0 * u_radius + 1.0);
}`;

const MAX_BLUR_RADIUS = 64;

class TexturePool {
  constructor(gl) {
    this.gl = gl;
    this.free = new Map();
    this.all = new Set();
  }

  acquire(width, height) {
    const key = `${width}x${height}`;
    const texture = this.free.get(key)?.pop() ?? new Texture(this.gl, width, height, "rgba16f");
    this.all.add(texture);
    return texture;
  }

  release(texture) {
    if (!texture || !this.all.has(texture)) return; // the source, or a cached LUT: not pooled
    const key = `${texture.width}x${texture.height}`;
    if (!this.free.has(key)) this.free.set(key, []);
    if (!this.free.get(key).includes(texture)) this.free.get(key).push(texture);
  }

  size() {
    return this.all.size;
  }

  destroy() {
    for (const texture of this.all) texture.destroy();
    this.all.clear();
    this.free.clear();
  }
}

// What an op sees while it renders. Its size is the op's *input* (the preview or the
// full-resolution original, after any earlier crop or rotation). Spatial parameters must be derived
// from `longEdge`, so the preview and the export match (AGENTS.md). Geometry ops return a texture
// of a different size, and later ops get a context sized to that.
class PassContext {
  constructor(runner, width, height) {
    this.runner = runner;
    this.width = width;
    this.height = height;
    this.longEdge = Math.max(width, height);
  }

  target(width = this.width, height = this.height) {
    return this.runner.pool.acquire(width, height);
  }

  release(...textures) {
    for (const t of textures) this.runner.pool.release(t);
  }

  // Draws `source` (a fragment shader body; the header and colour library are prepended) into
  // `target`, with `inputs` bound as samplers. Returns the target.
  pass(source, { inputs = {}, uniforms = {}, target }) {
    const program = this.runner.program(source);
    const samplers = {};
    Object.entries(inputs).forEach(([name, texture], unit) => {
      texture.bind(unit);
      samplers[name] = { unit };
    });
    target.drawTo();
    this.runner.gl.useProgram(program.handle);
    program.setUniforms({ ...uniforms, ...samplers });
    program.draw();
    return target;
  }

  // A texture about `factor` times smaller, made by repeated 2x2 box averaging, so each output
  // pixel is the true mean of its block (one big bilinear step would alias). Caller releases it.
  downsample(texture, factor) {
    let current = texture;
    let remaining = factor;
    while (remaining >= 2 && current.width > 1 && current.height > 1) {
      const next = this.target(Math.max(1, Math.ceil(current.width / 2)), Math.max(1, Math.ceil(current.height / 2)));
      this.pass(HALVE, { inputs: { u_image: current }, target: next });
      if (current !== texture) this.release(current);
      current = next;
      remaining /= 2;
    }
    if (current === texture) { // factor < 2: still hand back a texture the caller owns
      const copy = this.target(texture.width, texture.height);
      this.pass(HALVE, { inputs: { u_image: texture }, target: copy });
      return copy;
    }
    return current;
  }

  // Separable Gaussian blur, all four channels, at `texture`'s own resolution. sigma is in that
  // texture's pixels. Caller releases the result.
  gaussian(texture, sigma) {
    const radius = Math.min(MAX_BLUR_RADIUS, Math.max(1, Math.ceil(3 * sigma)));
    const weights = new Float32Array(65);
    let sum = 0;
    for (let i = 0; i <= radius; i++) {
      weights[i] = Math.exp(-(i * i) / (2 * sigma * sigma));
      sum += i === 0 ? weights[i] : 2 * weights[i];
    }
    for (let i = 0; i <= radius; i++) weights[i] /= sum;
    const uniforms = { u_radius: radius, u_weights: { floats: weights } };
    const horizontal = this.pass(GAUSSIAN, { inputs: { u_image: texture }, uniforms: { ...uniforms, u_step: [1 / texture.width, 0] }, target: this.target(texture.width, texture.height) });
    const vertical = this.pass(GAUSSIAN, { inputs: { u_image: horizontal }, uniforms: { ...uniforms, u_step: [0, 1 / texture.height] }, target: this.target(texture.width, texture.height) });
    this.release(horizontal);
    return vertical;
  }

  // Separable box mean over (2r+1)^2 pixels at `texture`'s resolution. Caller releases the result.
  box(texture, radius) {
    const r = Math.min(MAX_BLUR_RADIUS, Math.max(1, Math.round(radius)));
    const horizontal = this.pass(BOX, { inputs: { u_image: texture }, uniforms: { u_radius: r, u_step: [1 / texture.width, 0] }, target: this.target(texture.width, texture.height) });
    const vertical = this.pass(BOX, { inputs: { u_image: horizontal }, uniforms: { u_radius: r, u_step: [0, 1 / texture.height] }, target: this.target(texture.width, texture.height) });
    this.release(horizontal);
    return vertical;
  }

  // A small data texture (e.g. a curve LUT) owned by the runner and cached by `key`, so dragging a
  // slider elsewhere doesn't rebuild it.
  lut(key, width, build) {
    return this.runner.lut(key, width, build);
  }
}

export class Pipeline {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = createContext(canvas);
    this.programs = new Map();
    this.pool = new TexturePool(this.gl);
    this.luts = new Map();
    this.source = null;
    this.lost = false;
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.lost = true; });
  }

  get maxTextureSize() {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
  }

  // The photo to edit: an <img>, ImageBitmap, or canvas, already upright (proof serves upright
  // previews and the browser applies EXIF orientation on decode). Replacing the source drops the
  // working textures sized for the old one.
  setSource(image) {
    const width = image.naturalWidth ?? image.width;
    const height = image.naturalHeight ?? image.height;
    const limit = Math.min(this.maxTextureSize, ...this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS));
    if (Math.max(width, height) > limit) {
      throw new PipelineUnsupported(`This photo is ${width}×${height}, larger than this GPU can process (${limit} px).`);
    }
    this.source?.destroy();
    this.pool.destroy();
    this.source = Texture.fromImage(this.gl, image);
  }

  program(source) {
    let program = this.programs.get(source);
    if (!program) {
      program = new Program(this.gl, HEADER + source);
      this.programs.set(source, program);
    }
    return program;
  }

  lut(key, width, build) {
    let texture = this.luts.get(key);
    if (!texture) {
      if (this.luts.size > 32) { // a few curves' worth; drop the oldest
        const [oldKey, old] = this.luts.entries().next().value;
        old.destroy();
        this.luts.delete(oldKey);
      }
      texture = new Texture(this.gl, width, 1, "rgba16f", build());
      this.luts.set(key, texture);
    }
    return texture;
  }

  // Renders `recipe` and returns the linear working texture (pooled; caller must release it).
  // Options:
  //   skipIdentity: false forces every tool to run even at its identity parameters (the pipeline
  //     tests use it to check that the maths really is an identity);
  //   original: true renders without the stack (the before/after comparison);
  //   upTo: renders only the first `upTo` stack entries (the editor shows a crop step's input
  //     while that crop is being adjusted).
  renderTexture(recipe, { skipIdentity = true, original = false, upTo = Infinity } = {}) {
    if (!this.source) throw new Error("no source photo");
    const decodeCtx = new PassContext(this, this.source.width, this.source.height);
    let current = decodeCtx.pass(DECODE, { inputs: { u_image: this.source }, target: decodeCtx.target() });
    if (!original) {
      for (const entry of recipe.stack.slice(0, upTo)) {
        const tool = TOOLS[entry.tool];
        if (skipIdentity && tool.isIdentity(entry.params)) continue;
        const ctx = new PassContext(this, current.width, current.height);
        const next = tool.apply(ctx, current, entry.params);
        if (next !== current) ctx.release(current);
        current = next;
      }
    }
    return current;
  }

  // Draws the rendered photo onto the canvas, at the source's full size (CSS scales it to fit).
  renderToCanvas(recipe, options) {
    const gl = this.gl;
    const result = this.renderTexture(recipe, options);
    if (this.canvas.width !== result.width || this.canvas.height !== result.height) {
      this.canvas.width = result.width;
      this.canvas.height = result.height;
    }
    result.bind(0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, result.width, result.height);
    const program = this.program(ENCODE);
    gl.useProgram(program.handle);
    program.setUniforms({ u_image: { unit: 0 }, u_flip: 1 });
    program.draw();
    this.pool.release(result);
  }

  // The rendered photo as 8-bit sRGB RGBA, top row first: exactly what the canvas shows, and what
  // Phase 11 encodes as the saved JPEG.
  renderToPixels(recipe, options) {
    const gl = this.gl;
    const result = this.renderTexture(recipe, options);
    const out = new Texture(gl, result.width, result.height, "rgba8");
    try {
      result.bind(0);
      out.drawTo();
      const program = this.program(ENCODE);
      gl.useProgram(program.handle);
      program.setUniforms({ u_image: { unit: 0 }, u_flip: 0 });
      program.draw();
      const pixels = new Uint8Array(result.width * result.height * 4);
      gl.readPixels(0, 0, result.width, result.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return { width: result.width, height: result.height, pixels };
    } finally {
      out.destroy();
      this.pool.release(result);
    }
  }

  // The linear working values before 8-bit encoding, for tests (finite, in range, ...).
  renderToFloats(recipe, options) {
    const gl = this.gl;
    const result = this.renderTexture(recipe, options);
    try {
      result.drawTo();
      const values = new Float32Array(result.width * result.height * 4);
      gl.readPixels(0, 0, result.width, result.height, gl.RGBA, gl.FLOAT, values);
      return { width: result.width, height: result.height, values };
    } finally {
      this.pool.release(result);
    }
  }

  destroy() {
    for (const p of this.programs.values()) p.destroy();
    for (const t of this.luts.values()) t.destroy();
    this.programs.clear();
    this.luts.clear();
    this.pool.destroy();
    this.source?.destroy();
    this.source = null;
    forgetContext(this.gl);
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
