/*
*  proof — Details (Snapseed's name): structure and sharpening, both on CIE Lab lightness.
*
*  Sharpening is ported from darktable (https://github.com/darktable-org/darktable) at commit
*  3fc4cfb252231edc687fefc469b3f7b7e2cade0a, src/iop/sharpen.c: an unsharp mask on L with a
*  Gaussian of sigma = radius / 2.5 and a soft threshold, leaving a/b untouched.
*    Copyright (C) 2009-2026 darktable developers.
*    darktable is free software: you can redistribute it and/or modify it under the terms of the
*    GNU General Public License as published by the Free Software Foundation, either version 3 of
*    the License, or (at your option) any later version.
*  See frontend/src/pipeline/LICENSES.md.
*
*  Structure is proof's own. It's local contrast on L built with a fast guided filter (He, Sun
*  and Tang, "Guided Image Filtering", 2010; He and Sun, "Fast Guided Filter", 2015): the
*  edge-aware base layer is kept, and detail around it is amplified (+) or flattened (-). darktable's
*  local contrast module (src/iop/bilat.c) uses a local Laplacian pyramid, which is too many passes
*  to run interactively in WebGL, especially on phones. The guided filter is the same edge-aware
*  primitive darktable's tone equalizer builds its masks with, and it doesn't halo at strong edges.
*  See docs/decisions.md.
*  Sizes are relative to the image's long edge, so the preview matches the export.
*/
import { shape, slider } from "./shared.js";

// L and L^2 (the guided filter's inputs), L in 0..1.
const LUMA = `
uniform sampler2D u_image;
void main() { float L = rgbToLab(texture(u_image, v_uv).rgb).x / 100.0; outColor = vec4(L, L * L, 0.0, 1.0); }`;

// Guided filter coefficients from box means of (I, I^2): a = var / (var + eps), b = mean - a*mean.
const COEFFICIENTS = `
uniform sampler2D u_means;
uniform float u_epsilon;
void main() {
  vec2 m = texture(u_means, v_uv).rg;
  float variance = max(m.y - m.x * m.x, 0.0);
  float a = variance / (variance + u_epsilon);
  outColor = vec4(a, m.x - a * m.x, 0.0, 1.0);
}`;

const COMBINE = `
uniform sampler2D u_image;
uniform sampler2D u_coefficients;  // box-averaged (a, b), low resolution, upsampled bilinearly
uniform sampler2D u_means;         // box means of (L, L^2), same resolution: local standard deviation
uniform sampler2D u_blurred;       // Gaussian-blurred L for sharpening
uniform float u_structure;         // 1.0 when structure is active
uniform float u_detailGain;        // multiplier on detail around the base layer; 1.0 = none
uniform float u_sharpen;           // 1.0 when sharpening is active
uniform float u_amount;            // darktable sharpen amount
uniform float u_threshold;         // darktable sharpen threshold, in L 0..1 units
// Structure enhances texture, not smooth gradients. An 8-bit JPEG's skies are made of 1-level
// quantisation steps, and lifting shadows stretches them further. Amplifying them as "detail" turns
// them into stripes. So the gain ramps in only where the detail itself is bigger than a noise floor
// (about 0.3 to 1.2 L*) *and* the neighbourhood is actually textured: local standard deviation
// from about 0.6 to 2 L*. Smooth areas keep their gradients. (L 0..1 units below.)
const float FLOOR_START = 0.003;
const float FLOOR_FULL = 0.012;
const float TEXTURE_START = 0.006;
const float TEXTURE_FULL = 0.02;
void main() {
  vec3 rgb = texture(u_image, v_uv).rgb;
  vec3 lab = rgbToLab(rgb);
  float L = lab.x / 100.0;
  float outL = L;
  if (u_structure > 0.5) {
    vec2 ab = texture(u_coefficients, v_uv).rg;
    float base = ab.x * L + ab.y;
    float detail = L - base;
    vec2 m = texture(u_means, v_uv).rg;
    float localStd = sqrt(max(m.y - m.x * m.x, 0.0));
    float gate = smoothstep(FLOOR_START, FLOOR_FULL, abs(detail)) * smoothstep(TEXTURE_START, TEXTURE_FULL, localStd);
    float gain = u_detailGain > 1.0 ? 1.0 + (u_detailGain - 1.0) * gate : u_detailGain;
    outL = base + detail * gain;
  }
  if (u_sharpen > 0.5) {
    // darktable sharpen.c: detail = in - blurred, soft-thresholded, scaled by amount.
    float diff = L - texture(u_blurred, v_uv).r;
    float detail = abs(diff) > u_threshold ? sign(diff) * max(abs(diff) - u_threshold, 0.0) : 0.0;
    outL += detail * u_amount;
  }
  outColor = vec4(labToRgb(vec3(outL * 100.0, lab.yz)), 1.0);
}`;

export const details = {
  id: "details",
  label: "Details",
  params: [slider("structure", "Structure"), slider("sharpening", "Sharpening", { min: 0, max: 100 })],
  isIdentity: (p) => p.structure === 0 && p.sharpening === 0,

  apply(ctx, input, p) {
    const structure = shape(p.structure);
    const sharpening = shape(p.sharpening);
    const luma = ctx.pass(LUMA, { inputs: { u_image: input }, target: ctx.target() });

    let coefficients = null;
    let localMeans = null;
    if (structure !== 0) {
      // Window radius ~1.2 % of the long edge, computed at reduced resolution (fast guided filter).
      const radius = 0.012 * ctx.longEdge;
      const factor = 2 ** Math.max(0, Math.floor(Math.log2(radius / 6)));
      const small = ctx.downsample(luma, factor);
      const smallRadius = radius * (small.width / ctx.width);
      const means = ctx.box(small, smallRadius);
      const ab = ctx.pass(COEFFICIENTS, { inputs: { u_means: means }, uniforms: { u_epsilon: 0.005 }, target: ctx.target(small.width, small.height) });
      coefficients = ctx.box(ab, smallRadius);
      ctx.release(small, ab);
      localMeans = means;
    }

    let blurred = null;
    if (sharpening !== 0) {
      // darktable's default radius is 2 px at full resolution: here 0.06 % of the long edge (2.4 px
      // on a 4000 px photo), at least half a pixel.
      const radius = Math.max(0.5, 0.0006 * ctx.longEdge);
      blurred = ctx.gaussian(luma, radius / 2.5);
    }

    const out = ctx.pass(COMBINE, {
      inputs: { u_image: input, u_coefficients: coefficients ?? luma, u_means: localMeans ?? luma, u_blurred: blurred ?? luma },
      uniforms: {
        u_structure: coefficients ? 1 : 0,
        u_detailGain: 1 + (structure > 0 ? 1.5 * structure : 0.8 * structure),
        u_sharpen: blurred ? 1 : 0,
        u_amount: 2 * sharpening, // darktable's amount range is 0..2 (default 0.5)
        u_threshold: 0.005, //      darktable's default threshold, 0.5 on its 0..100 L scale
      },
      target: ctx.target(),
    });
    ctx.release(luma, coefficients, localMeans, blurred);
    return out;
  },
};
