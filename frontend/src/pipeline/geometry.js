/*
*  proof — geometry maths for Crop, Rotate, and Perspective.
*
*  The homography helpers (squareToQuad, invert3, multiply3) are derived from mini-gl
*  src/filters/filterPerspective.js at commit 28238857 (https://github.com/xdadda/mini-gl), MIT,
*  Copyright (c) 2025 xdadda, itself from glfx.js, MIT, Copyright (C) 2011 by Evan Wallace. The
*  square-to-quad formula is the one in javax.media.jai.PerspectiveTransform (Heckbert's projective
*  mapping). See frontend/src/pipeline/LICENSES.md. Everything else here is proof's.
*
*  Conventions: image coordinates in pixels, origin at the top-left, y down (texture v = 0 is the
*  photo's top row in this pipeline). Matrices are row-major, as in color.js, and passed to GLSL as
*  is, then used as `vec3 * M`.
*/

// Maps the unit square (0,0) (1,0) (1,1) (0,1) to the quad p0..p3 (corners in that order).
// Row-major, applied to column vectors (x, y, 1).
function squareToQuad([x0, y0], [x1, y1], [x2, y2], [x3, y3]) {
  const dx1 = x1 - x2, dy1 = y1 - y2;
  const dx2 = x3 - x2, dy2 = y3 - y2;
  const dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const a = (dx3 * dy2 - dx2 * dy3) / det;
  const b = (dx1 * dy3 - dx3 * dy1) / det;
  // glfx returns this transposed (for row vectors). Here it's transposed back to row-major.
  return [
    x1 - x0 + a * x1, x3 - x0 + b * x3, x0,
    y1 - y0 + a * y1, y3 - y0 + b * y3, y0,
    a, b, 1,
  ];
}

function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * e * i - a * f * h - b * d * i + b * f * g + c * d * h - c * e * g;
  return [
    (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
}

function multiply3(a, b) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return out;
}

export function apply3(m, [x, y]) {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

// ---- crop ----------------------------------------------------------------------------------

// The crop rectangle in whole pixels of a width x height image. Rounding to pixels keeps a crop
// lossless (a straight copy, no resampling). The preview and the export round the same relative
// rectangle, so they differ by under a pixel.
export function cropPixels([x, y, w, h], width, height) {
  const x0 = Math.min(width - 1, Math.max(0, Math.round(x * width)));
  const y0 = Math.min(height - 1, Math.max(0, Math.round(y * height)));
  const x1 = Math.min(width, Math.max(x0 + 1, Math.round((x + w) * width)));
  const y1 = Math.min(height, Math.max(y0 + 1, Math.round((y + h) * height)));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// The pixel aspect (width / height) an aspect setting asks for, or null for free.
export function aspectRatio(aspect, imageWidth, imageHeight) {
  if (aspect === "free") return null;
  if (aspect === "original") return imageWidth / imageHeight;
  const [a, b] = aspect.split(":").map(Number);
  return a / b;
}

// The largest rectangle with this pixel aspect, centred in the image, in normalised [x, y, w, h].
export function centredRect(ratio, imageWidth, imageHeight) {
  const imageRatio = imageWidth / imageHeight;
  const w = ratio > imageRatio ? 1 : ratio / imageRatio;
  const h = ratio > imageRatio ? imageRatio / ratio : 1;
  return [(1 - w) / 2, (1 - h) / 2, w, h];
}

// ---- rotate ----------------------------------------------------------------------------------

// Size after quarter turns (an odd number of turns swaps width and height).
function turnedSize(width, height, quarterTurns) {
  return quarterTurns % 2 ? [height, width] : [width, height];
}

// Fine rotation crops to the largest rectangle with the image's own aspect that fits inside the
// rotated image (so there are no blank corners, as in Snapseed and Lightroom). Returns its scale
// relative to the image: the rotated-back rectangle's bounding box must fit the image on both axes.
export function straightenScale(width, height, degrees) {
  const t = Math.abs((degrees * Math.PI) / 180);
  const c = Math.cos(t), s = Math.sin(t);
  return Math.min(width / (width * c + height * s), height / (width * s + height * c));
}

// The matrix from output pixel coordinates to input pixel coordinates (both y-down, pixel units)
// for: a horizontal flip, then quarter turns clockwise, then a fine clockwise rotation by `degrees`
// with the auto-crop scale above. Returns the matrix and the output size.
export function rotationMapping(width, height, { quarterTurns, flip, angle }) {
  const [tw, th] = turnedSize(width, height, quarterTurns);
  const scale = straightenScale(tw, th, angle);
  const outW = Math.max(1, Math.round(tw * scale));
  const outH = Math.max(1, Math.round(th * scale));

  // Build output -> input as a chain of inverses, each about the centre:
  // output (outW x outH) --undo fine rotation--> turned (tw x th) --undo turns--> flipped --undo flip--> input.
  const translate = (x, y) => [1, 0, x, 0, 1, y, 0, 0, 1];
  const rotate = (radians) => { const c = Math.cos(radians), s = Math.sin(radians); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
  // In y-down coordinates, [[c, -s], [s, c]] with a positive angle turns content clockwise on screen.
  // Undoing a clockwise rotation by `angle` is rotating by -angle.
  let m = translate(-outW / 2, -outH / 2);
  m = multiply3(rotate((-angle * Math.PI) / 180), m);
  m = multiply3(translate(tw / 2, th / 2), m);
  // Undo quarter turns: turned (tw x th) -> flipped (width x height), one clockwise turn at a time.
  // A clockwise turn maps (x, y) in a w x h image to (h - y, x), so undoing it maps (u, v) in
  // the turned h x w image back to (v, h - u).
  let w = tw, h = th;
  for (let i = 0; i < quarterTurns % 4; i++) {
    // turned image size is (w, h); before this turn the image was (h, w).
    m = multiply3([0, 1, 0, -1, 0, w, 0, 0, 1], m);
    [w, h] = [h, w];
  }
  if (flip) m = multiply3([-1, 0, width, 0, 1, 0, 0, 0, 1], m);
  return { matrix: m, width: outW, height: outH };
}

// ---- perspective ----------------------------------------------------------------------------

// Keystone correction as the source quad that's stretched to fill the frame. `vertical` > 0
// narrows the quad's top (it stretches the top of the photo, which straightens verticals that
// converge upwards). `horizontal` > 0 narrows its left side. Both are -1..1, and the narrowing is up
// to MAX_KEYSTONE of the width or height. The quad always lies inside the photo, so the output
// is fully covered and needs no fill.
const MAX_KEYSTONE = 0.4;

export function keystoneQuad(width, height, vertical, horizontal) {
  const top = Math.max(0, vertical) * MAX_KEYSTONE * width / 2;
  const bottom = Math.max(0, -vertical) * MAX_KEYSTONE * width / 2;
  const left = Math.max(0, horizontal) * MAX_KEYSTONE * height / 2;
  const right = Math.max(0, -horizontal) * MAX_KEYSTONE * height / 2;
  return [
    [top, left], //                    top-left
    [width - top, right], //           top-right
    [width - bottom, height - right], // bottom-right
    [bottom, height - left], //        bottom-left
  ];
}

// Output pixel coordinates -> input pixel coordinates for a perspective that maps the given input
// quad onto the whole output frame (same size as the input).
export function perspectiveMapping(width, height, quad) {
  const toUnit = [1 / width, 0, 0, 0, 1 / height, 0, 0, 0, 1];
  return multiply3(squareToQuad(...quad), toUnit);
}
