import { cropPixels, keystoneQuad, multiply3, perspectiveMapping, rotationMapping } from "../geometry.js";
import { WARP } from "./geometry-shader.js";
import { shape, slider } from "./shared.js";

// Crop & Rotate: every geometry change in one tool (Snapseed's Crop, Rotate, and Perspective), so
// it's one edit layer and the photo is resampled once. Applied in this order, as one composed
// output -> input matrix:
//   1. a horizontal flip and quarter turns clockwise (exact: whole pixels move);
//   2. vertical and horizontal keystone, on the turned photo, so "vertical" is vertical on screen.
//      The quad is always inside the photo, so the output needs no fill;
//   3. a fine straighten angle (positive is clockwise), auto-cropped to the largest rectangle with
//      the photo's own aspect that fits, so there are never blank corners;
//   4. the crop rectangle, normalised to the result of 1-3 ([x, y, w, h], 0..1) and rounded to
//      whole pixels.
// With no straighten or keystone, the composed matrix lands on input pixel centres and copies them
// (lossless). Otherwise it's Catmull-Rom bicubic.
export const ASPECT_OPTIONS = ["free", "original", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16"];

export const cropRotate = {
  id: "croprotate",
  label: "Crop & Rotate",
  // While selected, the editor shows this step with the crop left out (the whole straightened
  // photo) and the crop box over it.
  geometry: "crop",
  params: [
    { id: "rect", label: "Crop", kind: "rect", default: [0, 0, 1, 1] },
    { id: "aspect", label: "Aspect", kind: "choice", options: ASPECT_OPTIONS, default: "free" },
    { id: "quarterTurns", label: "Rotate", kind: "turns", default: 0 },
    { id: "flip", label: "Flip", kind: "toggle", default: false },
    { id: "angle", label: "Straighten", min: -45, max: 45, step: 0.1, unit: "°", default: 0 },
    slider("vertical", "Vertical"),
    slider("horizontal", "Horizontal"),
  ],
  isIdentity: (p) => p.rect[0] === 0 && p.rect[1] === 0 && p.rect[2] === 1 && p.rect[3] === 1 &&
    p.quarterTurns === 0 && !p.flip && p.angle === 0 && p.vertical === 0 && p.horizontal === 0,
  apply(ctx, input, p) {
    const turned = rotationMapping(input.width, input.height, { quarterTurns: p.quarterTurns, flip: p.flip, angle: 0 });
    const [w, h] = [turned.width, turned.height];
    const keystone = perspectiveMapping(w, h, keystoneQuad(w, h, shape(p.vertical), shape(p.horizontal)));
    const straight = rotationMapping(w, h, { quarterTurns: 0, flip: false, angle: p.angle });
    const r = cropPixels(p.rect, straight.width, straight.height);
    const crop = [1, 0, r.x, 0, 1, r.y, 0, 0, 1];
    return ctx.pass(WARP, {
      inputs: { u_image: input },
      uniforms: {
        u_map: multiply3(turned.matrix, multiply3(keystone, multiply3(straight.matrix, crop))),
        u_cubic: p.angle !== 0 || p.vertical !== 0 || p.horizontal !== 0 ? 1 : 0,
      },
      target: ctx.target(r.width, r.height),
    });
  },
};
