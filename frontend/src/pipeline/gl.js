/*
*  proof — third-party code, see frontend/src/pipeline/LICENSES.md.
*  Derived from mini-gl src/minigl.js at commit 28238857b0499dd39958ae3e45990e78fffdd454
*  (https://github.com/xdadda/mini-gl), MIT, Copyright (c) 2025 xdadda. mini-gl is itself derived
*  from glfx.js, MIT, Copyright (C) 2011 by Evan Wallace.
*
*  proof's changes (V1_PLAN.md Phase 8):
*   - split up: this file keeps the GL plumbing (context, Texture, Program). The ping-pong runner
*     is now runner.js, and mini-gl's filters were not carried over (docs/decisions.md, provenance
*     audit);
*   - EXT_color_buffer_float is required, and intermediates are RGBA16F (linear, unclamped)
*     instead of SRGB8_ALPHA8, as decided by the Phase 1 spike;
*   - a static full-screen triangle in a vertex array object, instead of re-uploading a quad
*     buffer on every draw;
*   - uniform locations cached per program, and sampler units assigned by the caller;
*   - no framebuffer kept as an expando on the GL context: each render target owns its own.
*/

export class PipelineUnsupported extends Error {}

// The one WebGL2 context a pipeline renders with. preserveDrawingBuffer stays off: the editor
// redraws on every change anyway, and keeping the buffer costs memory and a copy per frame.
export function createContext(canvas) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: false, depth: false, stencil: false });
  if (!gl) throw new PipelineUnsupported("This browser doesn't support WebGL2.");
  // Half-float render targets: required, with no 8-bit fallback (docs/decisions.md, Phase 1).
  if (!gl.getExtension("EXT_color_buffer_float")) {
    throw new PipelineUnsupported("This browser can't render to floating-point textures (EXT_color_buffer_float), which the editor needs.");
  }
  gl.drawingBufferColorSpace = "srgb";
  gl.unpackColorSpace = "srgb";
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
  gl.disable(gl.DITHER); // proof dithers deliberately in its own output pass
  return gl;
}

const FORMATS = {
  // Decoded photo: sampling an SRGB8_ALPHA8 texture returns linear values.
  srgb8: (gl) => ({ internal: gl.SRGB8_ALPHA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }),
  // Working images: linear light, half-float, unclamped.
  rgba16f: (gl) => ({ internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }),
  // Final 8-bit output for readback. The output shader writes already-encoded sRGB values.
  rgba8: (gl) => ({ internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }),
};

export class Texture {
  constructor(gl, width, height, format, source = null) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.format = format;
    this.handle = gl.createTexture();
    this.framebuffer = null;
    const f = FORMATS[format](gl);
    gl.bindTexture(gl.TEXTURE_2D, this.handle);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (source && !ArrayBuffer.isView(source)) {
      gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, f.format, f.type, source); // an image, bitmap, or canvas
    } else if (source) {
      // Float data (e.g. a curve LUT) into a half-float texture: WebGL2 converts FLOAT to RGBA16F.
      gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, width, height, 0, f.format, gl.FLOAT, source);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, width, height, 0, f.format, f.type, null);
    }
  }

  static fromImage(gl, image) {
    return new Texture(gl, image.naturalWidth ?? image.width, image.naturalHeight ?? image.height, "srgb8", image);
  }

  bind(unit) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.handle);
  }

  // Makes this texture the render target.
  drawTo() {
    const gl = this.gl;
    if (!this.framebuffer) {
      this.framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.handle, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`incomplete framebuffer (${this.format})`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
  }

  destroy() {
    if (this.framebuffer) this.gl.deleteFramebuffer(this.framebuffer);
    this.gl.deleteTexture(this.handle);
    this.handle = this.framebuffer = null;
  }
}

// Every pass draws one triangle that covers the viewport. v_uv runs 0..1 over the target, which
// is also the coordinate used to sample same-aspect inputs of any size.
const VERTEX_SOURCE = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const fullScreenTriangle = new WeakMap();

function triangleFor(gl) {
  let vao = fullScreenTriangle.get(gl);
  if (vao) return vao;
  vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  fullScreenTriangle.set(gl, vao);
  return vao;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile error: ${log}\n${source.split("\n").map((l, i) => `${i + 1}: ${l}`).join("\n")}`);
  }
  return shader;
}

export class Program {
  constructor(gl, fragmentSource) {
    this.gl = gl;
    this.handle = gl.createProgram();
    gl.attachShader(this.handle, compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE));
    gl.attachShader(this.handle, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
    gl.bindAttribLocation(this.handle, 0, "a_position");
    gl.linkProgram(this.handle);
    if (!gl.getProgramParameter(this.handle, gl.LINK_STATUS)) throw new Error(`program link error: ${gl.getProgramInfoLog(this.handle)}`);
    this.locations = new Map();
  }

  location(name) {
    if (!this.locations.has(name)) this.locations.set(name, this.gl.getUniformLocation(this.handle, name));
    return this.locations.get(name);
  }

  // Numbers become float uniforms, arrays of 2-4 become vecN, 9 a mat3, {unit} a sampler, and
  // {floats} a float[] array.
  // Uniforms the shader doesn't use are skipped (their location is null).
  setUniforms(uniforms) {
    const gl = this.gl;
    for (const [name, value] of Object.entries(uniforms)) {
      const loc = this.location(name);
      if (loc === null) continue;
      if (typeof value === "number") gl.uniform1f(loc, value);
      else if (value && typeof value.unit === "number") gl.uniform1i(loc, value.unit);
      else if (value && value.floats) gl.uniform1fv(loc, value.floats); // a float[] uniform
      else if (value.length === 2) gl.uniform2fv(loc, value);
      else if (value.length === 3) gl.uniform3fv(loc, value);
      else if (value.length === 4) gl.uniform4fv(loc, value);
      else if (value.length === 9) gl.uniformMatrix3fv(loc, false, value);
      else throw new Error(`can't set uniform ${name} from ${value}`);
    }
  }

  draw() {
    const gl = this.gl;
    gl.useProgram(this.handle);
    gl.bindVertexArray(triangleFor(gl));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy() {
    this.gl.deleteProgram(this.handle);
  }
}

export function forgetContext(gl) {
  fullScreenTriangle.delete(gl);
}
