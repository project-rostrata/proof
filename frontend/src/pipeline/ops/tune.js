/*
*  proof — Tune Image (Snapseed's name): brightness, contrast, saturation, ambiance, highlights,
*  shadows, and warmth.
*
*  Contains code ported from darktable (https://github.com/darktable-org/darktable) at commit
*  3fc4cfb252231edc687fefc469b3f7b7e2cade0a:
*   - shadows and highlights: src/iop/shadhi.c and data/kernels/gaussian.cl (the overlay() blend
*     driven by an inverted, blurred lightness mask, and its parameter scaling);
*   - brightness, contrast, saturation, and vibrance: src/iop/colorbalancergb.c (luminance power,
*     grey-fulcrum contrast, chroma and vibrance in Filmlight Ych, then the Yrg gamut check).
*    Copyright (C) 2009-2026 darktable developers.
*    darktable is free software: you can redistribute it and/or modify it under the terms of the
*    GNU General Public License as published by the Free Software Foundation, either version 3 of
*    the License, or (at your option) any later version.
*  See frontend/src/pipeline/LICENSES.md.
*
*  Adapted for proof's display-referred input (an sRGB JPEG, values 0..1). darktable is
*  scene-referred with unbounded values:
*   - shadhi runs in bounded mode: L is clamped to 0..100, where darktable's default is unbounded;
*   - contrast is mirrored above the fulcrum, so 0 stays 0 and 1 stays 1 instead of white being
*     pushed past 1 and clipping;
*   - shadows colour correction is 50 % instead of darktable's 100 %, so JPEG colour noise in the
*     darks isn't amplified into bands when they're lifted;
*   - the lightness mask's blur radius is relative to the image (2.5% of the long edge, about
*     darktable's default 100 px on a 4000 px photo), so the preview matches the export.
*  Ambiance has no darktable equivalent (and Snapseed's isn't published). In proof it's vibrance
*  plus a gentle shadow lift and highlight compression through the same shadhi blend.
*  Colour space: linear sRGB in and out. Shadows/highlights work in CIE Lab (D65); the rest in
*  Filmlight Yrg/Ych.
*/
import { whiteBalanceMatrix } from "../color.js";
import { shape, slider, allZero } from "./shared.js";

const PARAMS = ["brightness", "contrast", "saturation", "ambiance", "highlights", "shadows", "warmth"];

// Warmth, then brightness: colorbalancergb's luminance power with the white fulcrum at 1
// (Y' = Y^(1/(1+p))), keeping Yrg chromaticity constant.
const TONE = `
uniform sampler2D u_image;
uniform mat3 u_warmth;
uniform float u_exponent;
void main() {
  vec3 rgb = texture(u_image, v_uv).rgb * u_warmth;
  if (u_exponent != 1.0) {
    vec3 Yrg = rgbToYrg(rgb);
    Yrg.x = pow(max(Yrg.x / WHITE_Y, 0.0), u_exponent) * WHITE_Y; // white fulcrum = sRGB white
    rgb = yrgToRgb(Yrg);
  }
  outColor = vec4(rgb, 1.0);
}`;

// darktable shadhi blurs Lab, clamped to 0..100. Only L matters, since the mask's a/b are zeroed.
const LIGHTNESS = `
uniform sampler2D u_image;
void main() { outColor = vec4(clamp(rgbToLab(texture(u_image, v_uv).rgb).x / 100.0, 0.0, 1.0), 0.0, 0.0, 1.0); }`;

const MIX = `
uniform sampler2D u_image;
uniform sampler2D u_mask;
uniform float u_shadhi;            // 1.0 when shadows or highlights are active
uniform float u_shadows;           // darktable internal scale: 2 * param / 100, -2..2
uniform float u_highlights;
uniform float u_shadowsCcorrect;
uniform float u_highlightsCcorrect;
uniform float u_compress;
uniform float u_contrast;          // exponent around the fulcrum; 1.0 = none
uniform float u_chroma;            // colorbalancergb chroma_global, -1..1
uniform float u_vibrance;          // colorbalancergb vibrance, -1..1

const float LOW_APPROXIMATION = 0.000001;
const float FULCRUM = 0.1845;      // colorbalancergb's default contrast grey fulcrum

// darktable gaussian.cl overlay() in bounded mode. a: Lab scaled to L 0..1, a/b /128.
// b: the mask's lightness, 0..1, with zero a/b.
vec3 overlay(vec3 a, float bL, float opacity, float transform, float ccorrect) {
  float opacity2 = opacity * opacity;
  for (int i = 0; i < 4; i++) {
    if (opacity2 <= 0.0) break;
    float la = clamp(a.x, 0.0, 1.0);
    float lb = clamp((bL - 0.5) * sign(opacity) * sign(1.0 - la) + 0.5, 0.0, 1.0);
    float lref = abs(la) > LOW_APPROXIMATION ? 1.0 / abs(la) : 1.0 / LOW_APPROXIMATION;
    float href = abs(1.0 - la) > LOW_APPROXIMATION ? 1.0 / abs(1.0 - la) : 1.0 / LOW_APPROXIMATION;
    float chunk = opacity2 > 1.0 ? 1.0 : opacity2;
    float optrans = chunk * transform;
    opacity2 -= 1.0;
    a.x = la * (1.0 - optrans) + (la > 0.5 ? 1.0 - (1.0 - 2.0 * (la - 0.5)) * (1.0 - lb) : 2.0 * la * lb) * optrans;
    a.x = clamp(a.x, 0.0, 1.0);
    float chromaFactor = a.x * lref * ccorrect + (1.0 - a.x) * href * (1.0 - ccorrect);
    a.yz = clamp(a.yz * (1.0 - optrans) + a.yz * chromaFactor * optrans, -1.0, 1.0);
  }
  return a;
}

void main() {
  vec3 rgb = texture(u_image, v_uv).rgb;

  if (u_shadhi > 0.5) {
    vec3 lab = rgbToLab(rgb);
    vec3 a = vec3(lab.x / 100.0, lab.yz / 128.0);
    float m = 1.0 - texture(u_mask, v_uv).r; // inverted blurred lightness
    float highlightsTransform = clamp(1.0 - m / (1.0 - u_compress), 0.0, 1.0);
    a = overlay(a, m, -u_highlights, highlightsTransform, 1.0 - u_highlightsCcorrect);
    float shadowsTransform = clamp(m / (1.0 - u_compress) - u_compress / (1.0 - u_compress), 0.0, 1.0);
    a = overlay(a, m, u_shadows, shadowsTransform, u_shadowsCcorrect);
    rgb = labToRgb(vec3(a.x * 100.0, a.yz * 128.0));
  }

  if (u_contrast != 1.0 || u_chroma != 0.0 || u_vibrance != 0.0) {
    vec3 Yrg = rgbToYrg(rgb);
    float Y = max(Yrg.x / WHITE_Y, 0.0); // 1.0 = sRGB white
    if (u_contrast != 1.0) {
      // colorbalancergb: Y' = fulcrum * (Y / fulcrum)^contrast, mirrored above the fulcrum so that
      // white stays white. Continuous with matching slope at the fulcrum, and monotone.
      float y = min(Y, 1.0);
      float toned = y <= FULCRUM
        ? FULCRUM * pow(y / FULCRUM, u_contrast)
        : 1.0 - (1.0 - FULCRUM) * pow((1.0 - y) / (1.0 - FULCRUM), u_contrast);
      Yrg.x = (toned + max(Y - 1.0, 0.0)) * WHITE_Y;
    }
    vec4 Ych = yrgToYch(Yrg);
    float vibrance = u_vibrance == 0.0 ? 0.0 : u_vibrance * (1.0 - pow(Ych.y, abs(u_vibrance)));
    Ych.y *= max(1.0 + u_chroma + vibrance, 0.0);
    rgb = yrgToRgb(ychToYrg(gamutCheckYrg(Ych)));
  }

  outColor = vec4(rgb, 1.0);
}`;

export const tune = {
  id: "tune",
  label: "Tune Image",
  params: [
    slider("brightness", "Brightness"),
    slider("contrast", "Contrast"),
    slider("saturation", "Saturation"),
    slider("ambiance", "Ambiance"),
    slider("highlights", "Highlights"),
    slider("shadows", "Shadows"),
    slider("warmth", "Warmth"),
  ],
  isIdentity: (p) => allZero(p, PARAMS),

  apply(ctx, input, p) {
    const ambiance = shape(p.ambiance);
    // darktable parameters, each -1..1 (shadhi's /100 scale, colorbalancergb's native range).
    const shadows = Math.max(-1, Math.min(1, shape(p.shadows) + 0.4 * ambiance));
    const highlights = Math.max(-1, Math.min(1, shape(p.highlights) - 0.4 * ambiance));
    const brightness = 0.6 * shape(p.brightness); // colorbalancergb midtones_Y, kept inside -1..1
    const warmth = shape(p.warmth);

    let toned = input;
    if (brightness !== 0 || warmth !== 0) {
      toned = ctx.pass(TONE, {
        inputs: { u_image: input },
        uniforms: { u_warmth: whiteBalanceMatrix(50 * warmth, 0), u_exponent: 1 / (1 + brightness) },
        target: ctx.target(),
      });
    }

    let mask = null;
    if (shadows !== 0 || highlights !== 0) {
      const lightness = ctx.pass(LIGHTNESS, { inputs: { u_image: toned }, target: ctx.target() });
      const sigma = 0.025 * ctx.longEdge;
      // Blur at reduced resolution (a box-averaged downsample) so the kernel stays a few dozen taps.
      const factor = 2 ** Math.max(0, Math.floor(Math.log2(sigma / 4)));
      const small = ctx.downsample(lightness, factor);
      ctx.release(lightness);
      mask = ctx.gaussian(small, sigma * (small.width / ctx.width));
      ctx.release(small);
    }

    // darktable shadhi commit/process: internal scale, compress 50 %, highlights colour correction
    // 50 % (its defaults), and shadows colour correction 50 % (see below).
    const sign = (v) => (v < 0 ? -1 : 1);
    const out = ctx.pass(MIX, {
      inputs: { u_image: toned, u_mask: mask ?? toned },
      uniforms: {
        u_shadhi: mask ? 1 : 0,
        u_shadows: 2 * shadows,
        u_highlights: 2 * highlights,
        // darktable's shadows colour correction defaults to 100 %: chroma scales with the lightness
        // ratio, so a near-black pixel lifted 5x gets 5x the chroma. On 8-bit JPEG input that
        // turns the JPEG's colour noise in the darks into visible bands. proof uses 50 %, which is
        // darktable's own default for highlights.
        u_shadowsCcorrect: (0.5 - 0.5) * sign(2 * shadows) + 0.5,
        u_highlightsCcorrect: (0.5 - 0.5) * sign(-2 * highlights) + 0.5,
        u_compress: 0.5,
        u_contrast: 1 + 0.5 * shape(p.contrast),
        u_chroma: shape(p.saturation),
        u_vibrance: 0.6 * ambiance,
      },
      target: ctx.target(),
    });
    if (toned !== input) ctx.release(toned);
    if (mask) ctx.release(mask);
    return out;
  },
};
