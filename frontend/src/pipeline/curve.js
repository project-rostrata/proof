/*
*  proof — tone curves: control points -> a smooth monotone curve -> a lookup table.
*
*  The interpolation is ported from darktable (https://github.com/darktable-org/darktable) at
*  commit 3fc4cfb252231edc687fefc469b3f7b7e2cade0a, src/common/curve_tools.c (monotone_hermite_set
*  for the tangents, catmull_rom_val to evaluate, and the flat-beyond-the-end-points sampling of
*  CurveDataSample):
*    Copyright (C) 2009-2026 darktable developers.
*    darktable is free software: you can redistribute it and/or modify it under the terms of the
*    GNU General Public License as published by the Free Software Foundation, either version 3 of
*    the License, or (at your option) any later version.
*  See frontend/src/pipeline/LICENSES.md.
*
*  A monotone (Fritsch-Carlson) Hermite spline never overshoots between control points, so a curve
*  the user drags stays where they put it, unlike a natural cubic spline (mini-gl's), which rings.
*/

const EPSILON = 2 * 1.1754943508222875e-38; // darktable: 2 * FLT_MIN

// monotone_hermite_set: tangents at each control point.
function tangents(x, y) {
  const n = x.length;
  const delta = new Array(n).fill(0);
  const m = new Array(n + 1).fill(0);
  for (let i = 0; i < n - 1; i++) delta[i] = (y[i + 1] - y[i]) / (x[i + 1] - x[i]);
  delta[n - 1] = delta[n - 2];
  m[0] = delta[0];
  m[n - 1] = delta[n - 1];
  for (let i = 1; i < n - 1; i++) m[i] = (delta[i - 1] + delta[i]) * 0.5;
  for (let i = 0; i < n; i++) {
    if (Math.abs(delta[i]) < EPSILON) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const alpha = m[i] / delta[i];
      const beta = m[i + 1] / delta[i];
      const tau = alpha * alpha + beta * beta;
      if (tau > 9) {
        m[i] = (3 * alpha * delta[i]) / Math.sqrt(tau);
        m[i + 1] = (3 * beta * delta[i]) / Math.sqrt(tau);
      }
    }
  }
  return m;
}

// catmull_rom_val: cubic Hermite evaluation on the interval containing xval.
function evaluate(x, y, m, xval) {
  const n = x.length;
  let i = n - 2;
  for (let k = 0; k < n - 2; k++) {
    if (xval < x[k + 1]) { i = k; break; }
  }
  const h = x[i + 1] - x[i];
  const t = (xval - x[i]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * h * m[i + 1];
}

// A function [0,1] -> [0,1] through `points` ([[x, y], ...], x strictly increasing), flat beyond
// the first and last points, clamped to range (as darktable samples its curves).
export function curveFunction(points) {
  const x = points.map((p) => p[0]);
  const y = points.map((p) => p[1]);
  const m = tangents(x, y);
  return (v) => {
    if (v <= x[0]) return y[0];
    if (v >= x[x.length - 1]) return y[y.length - 1];
    return Math.min(1, Math.max(0, evaluate(x, y, m, v)));
  };
}

export const IDENTITY_CURVE = [[0, 0], [1, 1]];

export function isIdentityCurve(points) {
  const f = curveFunction(points);
  for (let i = 0; i <= 64; i++) if (Math.abs(f(i / 64) - i / 64) > 1e-6) return false;
  return true;
}
