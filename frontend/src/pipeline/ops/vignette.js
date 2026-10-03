/*
*  proof — Vignette: darken (or lighten) the edges, and optionally lift or dim the centre.
*
*  Ported from darktable (https://github.com/darktable-org/darktable) at commit
*  3fc4cfb252231edc687fefc469b3f7b7e2cade0a, src/iop/vignette.c (process()): the super-ellipse
*  distance with "automatic ratio" (the ellipse follows the frame), the inner radius and fall-off,
*  and the falloff applied multiplicatively for darkening and additively for brightening.
*    Copyright (C) 2009-2026 darktable developers.
*    darktable is free software: you can redistribute it and/or modify it under the terms of the
*    GNU General Public License as published by the Free Software Foundation, either version 3 of
*    the License, or (at your option) any later version.
*  See frontend/src/pipeline/LICENSES.md.
*
*  proof's differences:
*   - the fall-off always uses darktable's cosine ease (darktable eases only when dithering), so
*     there's no visible edge where the vignette starts;
*   - Snapseed's "inner brightness" is added: the same falloff, inverted, applied to the centre;
*   - darktable's saturation reduction isn't exposed (Snapseed has none).
*  Colour space: linear sRGB in and out, like darktable's RGB vignette.
*/
import { shape } from "./shared.js";

const VIGNETTE = `
uniform sampler2D u_image;
uniform float u_outer;   // -1..1: < 0 darkens the edges (multiply), > 0 lightens them (add)
uniform float u_inner;   // -1..1: the same for the centre
uniform float u_radius;  // where the fall-off starts, in units of the frame's half-size
uniform float u_falloff; // fall-off width, same units

vec3 applyBrightness(vec3 c, float weight, float brightness) {
  if (weight <= 0.0 || brightness == 0.0) return c;
  return brightness < 0.0 ? c * (1.0 + weight * brightness) : c + weight * brightness;
}

void main() {
  vec3 rgb = texture(u_image, v_uv).rgb;
  vec2 p = abs(v_uv * 2.0 - 1.0);        // automatic ratio: an ellipse that follows the frame
  float distance = length(p);            // darktable's shape 1: pow(px^2 + py^2, 1/2)
  float w = clamp((distance - u_radius) / u_falloff, 0.0, 1.0);
  w = 0.5 - cos(3.14159265 * w) / 2.0;   // darktable's cosine ease
  rgb = applyBrightness(rgb, w, u_outer);
  rgb = applyBrightness(rgb, 1.0 - w, u_inner);
  outColor = vec4(rgb, 1.0);
}`;

export const vignette = {
  id: "vignette",
  label: "Vignette",
  params: [
    { id: "outer", label: "Outer brightness", min: -100, max: 100, default: 0 },
    { id: "inner", label: "Inner brightness", min: -100, max: 100, default: 0 },
    { id: "size", label: "Size", min: 0, max: 100, default: 50 },
  ],
  isIdentity: (p) => p.outer === 0 && p.inner === 0,
  apply(ctx, input, p) {
    return ctx.pass(VIGNETTE, {
      inputs: { u_image: input },
      uniforms: {
        u_outer: shape(p.outer),
        u_inner: shape(p.inner),
        // darktable's defaults are an inner radius of 0.8 and a 0.5 fall-off. Size 50 gives about that.
        u_radius: 0.25 + 0.011 * p.size,
        u_falloff: 0.5,
      },
      target: ctx.target(),
    });
  },
};
