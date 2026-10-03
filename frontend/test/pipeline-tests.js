// Pipeline tests (AGENTS.md "Testing"). Every tool must be an exact identity at its defaults, and
// stay finite and in range at its extremes. Each tool's maths is checked against a CPU reference,
// or against the property it promises (monotone, endpoints kept, neutral stays neutral, preview
// matches export). Results go into the page and window.__pipelineTests (for headless runs).
import { Pipeline } from "../src/pipeline/runner.js";
import { TOOLS, TOOL_ORDER } from "../src/pipeline/ops/index.js";
import { loadRecipe, newEntry, emptyRecipe, RecipeError, RECIPE_VERSION } from "../src/pipeline/recipe.js";
import { curveFunction, IDENTITY_CURVE } from "../src/pipeline/curve.js";
import { shape } from "../src/pipeline/ops/shared.js";
import { rotationMapping, straightenScale, apply3 } from "../src/pipeline/geometry.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

class Failure extends Error {}
function check(condition, message) { if (!condition) throw new Failure(message); }

// ---- helpers ----

const srgbEncode = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const srgbDecode = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

// A canvas filled by fill(x, y) -> [r, g, b] in 0..255.
function image(width, height, fill) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
  const data = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = fill(x, y);
    data.data.set([r, g, b, 255], (y * width + x) * 4);
  }
  ctx.putImageData(data, 0, 0);
  return { canvas, pixels: data.data, width, height };
}

// 256 x 8: rows are a grey ramp (every code value), red/green/blue ramps, a muted-colour ramp, a
// saturated sweep, then pure black and pure white.
const PATTERN = image(256, 8, (x, y) => [
  [x, x, x], [x, 0, 0], [0, x, 0], [0, 0, x], [x, Math.round(x * 0.7), Math.round(x * 0.5)],
  [255 - x, x, (x * 3) % 256], [0, 0, 0], [255, 255, 255],
][y]);
const ROW = { grey: 0, muted: 4, black: 6, white: 7 };

const pipeline = new Pipeline(document.createElement("canvas"));
function render(source, recipe, options) {
  pipeline.setSource(source.canvas);
  return pipeline.renderToPixels(recipe, options).pixels;
}
const recipeOf = (...entries) => ({ version: RECIPE_VERSION, stack: entries });
function entry(tool, params) { const e = newEntry(tool); Object.assign(e.params, params); return e; }

function diff(a, b) {
  let max = 0, sum = 0, count = 0;
  for (let i = 0; i < a.length; i++) {
    if (i % 4 === 3) continue;
    const d = Math.abs(a[i] - b[i]);
    max = Math.max(max, d);
    sum += d;
    count++;
  }
  return { max, mean: sum / count };
}

const px = (pixels, width, x, y) => { const i = (y * width + x) * 4; return [pixels[i], pixels[i + 1], pixels[i + 2]]; };
const greyRow = (pixels) => Array.from({ length: 256 }, (_, x) => px(pixels, 256, x, ROW.grey));
const lum = ([r, g, b]) => 0.2126 * srgbDecode(r / 255) + 0.7152 * srgbDecode(g / 255) + 0.0722 * srgbDecode(b / 255);

// ---- identity ----

test("an empty recipe renders the photo bit-identically", () => {
  const d = diff(render(PATTERN, emptyRecipe()), PATTERN.pixels);
  check(d.max === 0, `max diff ${d.max}`);
});

for (const id of TOOL_ORDER.filter((t) => TOOLS[t].identityAtDefaults !== false)) {
  test(`${TOOLS[id].label} at its defaults is skipped (exact) and, forced to run, is an identity within 1 level`, () => {
    const recipe = recipeOf(newEntry(id));
    check(TOOLS[id].isIdentity(recipe.stack[0].params), "defaults not recognised as identity");
    const skipped = diff(render(PATTERN, recipe), PATTERN.pixels);
    check(skipped.max === 0, `skipped path changed pixels (max ${skipped.max})`);
    const forced = diff(render(PATTERN, recipe, { skipIdentity: false }), PATTERN.pixels);
    check(forced.max <= 1, `forced path max diff ${forced.max}, mean ${forced.mean.toFixed(3)}`);
  });
}

// ---- robustness: the Phase 1 spike found mini-gl's highlights/shadows NaN on black ----

test("every slider at both extremes stays finite on black, white, primaries and ramps", () => {
  pipeline.setSource(PATTERN.canvas);
  for (const id of TOOL_ORDER) {
    for (const spec of TOOLS[id].params.filter((p) => !p.kind)) {
      for (const value of [spec.min, spec.max]) {
        const { values } = pipeline.renderToFloats(recipeOf(entry(id, { [spec.id]: value })));
        const bad = values.findIndex((v) => !Number.isFinite(v));
        check(bad < 0, `${id}.${spec.id}=${value}: non-finite value at index ${bad}`);
      }
    }
  }
  const everything = recipeOf(...TOOL_ORDER.map((id) => entry(id, Object.fromEntries(TOOLS[id].params.filter((p) => !p.kind).map((p) => [p.id, p.max])))));
  const { values } = pipeline.renderToFloats(everything);
  check(values.every(Number.isFinite), "all tools at max: non-finite values");
});

test("black stays black and white stays white under every tone slider", () => {
  for (const [param, value] of [["brightness", 100], ["brightness", -100], ["contrast", 100], ["contrast", -100], ["shadows", 100], ["highlights", -100], ["highlights", 100], ["ambiance", 100]]) {
    const out = render(PATTERN, recipeOf(entry("tune", { [param]: value })));
    const black = px(out, 256, 10, ROW.black);
    const white = px(out, 256, 10, ROW.white);
    check(Math.max(...black) <= 1, `${param}=${value}: black became ${black}`);
    check(Math.min(...white) >= 254, `${param}=${value}: white became ${white}`);
  }
});

// ---- Tune Image against CPU references (neutral greys, where Yrg tone maps reduce to 1-D) ----

function compareGreyRamp(params, reference, tolerance = 1) {
  const out = greyRow(render(PATTERN, recipeOf(entry("tune", params))));
  let worst = { error: 0 };
  out.forEach(([r, g, b], x) => {
    const expected = Math.round(srgbEncode(Math.min(1, Math.max(0, reference(srgbDecode(x / 255))))) * 255);
    const error = Math.max(Math.abs(r - expected), Math.abs(g - expected), Math.abs(b - expected));
    if (error > worst.error) worst = { error, x, got: [r, g, b], expected };
  });
  check(worst.error <= tolerance, `worst at input ${worst.x}: got ${worst.got}, expected ${worst.expected}`);
  return out.map((p) => p[0]);
}

for (const value of [60, -60, 100]) {
  test(`brightness ${value} matches colorbalancergb's luminance power on a grey ramp`, () => {
    const exponent = 1 / (1 + 0.6 * shape(value));
    compareGreyRamp({ brightness: value }, (v) => v ** exponent);
  });
}

const FULCRUM = 0.1845;
for (const value of [60, -60, 100]) {
  test(`contrast ${value} matches the mirrored grey-fulcrum curve, keeping 0, the fulcrum and 1`, () => {
    const k = 1 + 0.5 * shape(value);
    const out = compareGreyRamp({ contrast: value }, (v) => (v <= FULCRUM ? FULCRUM * (v / FULCRUM) ** k : 1 - (1 - FULCRUM) * ((1 - v) / (1 - FULCRUM)) ** k));
    // Monotone up to the output dither, which can put neighbouring equal values one level apart.
    for (let x = 1; x < 256; x++) check(out[x] >= out[x - 1] - 1, `not monotone at ${x}: ${out[x - 1]} -> ${out[x]}`);
  });
}

test("saturation ±100 leaves neutral greys exactly neutral", () => {
  for (const value of [100, -100]) {
    greyRow(render(PATTERN, recipeOf(entry("tune", { saturation: value })))).forEach(([r, g, b], x) => {
      check(Math.max(r, g, b) - Math.min(r, g, b) <= 1, `saturation ${value}: grey ${x} became ${[r, g, b]}`);
    });
  }
});

test("saturation -100 removes colour; +50 adds it without changing luminance much", () => {
  const grey = render(PATTERN, recipeOf(entry("tune", { saturation: -100 })));
  const more = render(PATTERN, recipeOf(entry("tune", { saturation: 50 })));
  for (const x of [64, 128, 200, 250]) {
    const before = px(PATTERN.pixels, 256, x, ROW.muted);
    const g = px(grey, 256, x, ROW.muted);
    check(Math.max(...g) - Math.min(...g) <= 2, `muted ${x} at -100: ${g}`);
    const m = px(more, 256, x, ROW.muted);
    check(Math.max(...m) - Math.min(...m) > Math.max(...before) - Math.min(...before), `muted ${x} at +50 not more colourful: ${before} -> ${m}`);
    check(Math.abs(lum(m) - lum(before)) / lum(before) < 0.04, `muted ${x}: luminance ${lum(before).toFixed(4)} -> ${lum(m).toFixed(4)}`);
  }
});

// ---- shadows / highlights (darktable shadhi) ----

// A dark-to-bright horizontal gradient, the classic case: lift the dark half, pull down the bright.
const GRADIENT = image(512, 64, (x) => { const v = Math.round((x / 511) * 255); return [v, v, v]; });
function meanRange(pixels, width, x0, x1, row = 32) { let s = 0; for (let x = x0; x < x1; x++) s += px(pixels, width, x, row)[1]; return s / (x1 - x0); }

test("shadows +100 lifts the dark end and leaves the bright end; highlights -100 does the reverse", () => {
  const base = { dark: meanRange(GRADIENT.pixels, 512, 20, 100), bright: meanRange(GRADIENT.pixels, 512, 420, 500) };
  const sh = render(GRADIENT, recipeOf(entry("tune", { shadows: 100 })));
  const hi = render(GRADIENT, recipeOf(entry("tune", { highlights: -100 })));
  const shDark = meanRange(sh, 512, 20, 100), shBright = meanRange(sh, 512, 420, 500);
  const hiDark = meanRange(hi, 512, 20, 100), hiBright = meanRange(hi, 512, 420, 500);
  check(shDark > base.dark + 10, `shadows: dark ${base.dark.toFixed(1)} -> ${shDark.toFixed(1)}`);
  check(Math.abs(shBright - base.bright) < 6, `shadows moved the bright end ${base.bright.toFixed(1)} -> ${shBright.toFixed(1)}`);
  check(hiBright < base.bright - 10, `highlights: bright ${base.bright.toFixed(1)} -> ${hiBright.toFixed(1)}`);
  check(Math.abs(hiDark - base.dark) < 6, `highlights moved the dark end ${base.dark.toFixed(1)} -> ${hiDark.toFixed(1)}`);
});

// ---- white balance and warmth ----

test("temperature + warms a grey (R > B), - cools it, at nearly constant luminance; tint + is magenta, - is green", () => {
  const at = (params) => px(render(PATTERN, recipeOf(entry("whitebalance", params))), 256, 160, ROW.grey);
  const grey = px(PATTERN.pixels, 256, 160, ROW.grey);
  const warm = at({ temperature: 60 }), cool = at({ temperature: -60 }), magenta = at({ tint: 60 }), green = at({ tint: -60 });
  check(warm[0] > warm[2] + 8, `warm ${warm}`);
  check(cool[2] > cool[0] + 8, `cool ${cool}`);
  check(magenta[1] < (magenta[0] + magenta[2]) / 2 - 3, `magenta ${magenta}`);
  check(green[1] > (green[0] + green[2]) / 2 + 3, `green ${green}`);
  for (const c of [warm, cool, magenta, green]) check(Math.abs(lum(c) - lum(grey)) / lum(grey) < 0.05, `luminance ${lum(grey).toFixed(4)} -> ${lum(c).toFixed(4)} for ${c}`);
});

test("Tune's warmth warms like White Balance's temperature", () => {
  const warm = px(render(PATTERN, recipeOf(entry("tune", { warmth: 60 }))), 256, 160, ROW.grey);
  check(warm[0] > warm[2] + 5, `warmth 60 gave ${warm}`);
});

// ---- curves ----

test("a master curve through (0.5, 0.75) maps the grey ramp through the same curve the editor draws", () => {
  const points = { rgb: [[0, 0], [0.5, 0.75], [1, 1]], red: IDENTITY_CURVE, green: IDENTITY_CURVE, blue: IDENTITY_CURVE };
  const f = curveFunction(points.rgb);
  const out = greyRow(render(PATTERN, recipeOf(entry("curves", { points }))));
  out.forEach(([r, g, b], x) => {
    const expected = Math.round(f(x / 255) * 255);
    check(Math.abs(r - expected) <= 1 && Math.abs(g - expected) <= 1 && Math.abs(b - expected) <= 1, `input ${x}: got ${[r, g, b]}, expected ${expected}`);
  });
});

test("a red-only curve changes only the red channel", () => {
  const points = { rgb: IDENTITY_CURVE, red: [[0, 0], [0.5, 0.65], [1, 1]], green: IDENTITY_CURVE, blue: IDENTITY_CURVE };
  greyRow(render(PATTERN, recipeOf(entry("curves", { points })))).forEach(([r, g, b], x) => {
    check(Math.abs(g - x) <= 1 && Math.abs(b - x) <= 1, `input ${x}: green/blue moved to ${g}/${b}`);
    if (x > 20 && x < 235) check(r > x, `input ${x}: red ${r} not raised`);
  });
});

test("the monotone curve never overshoots its control points (a natural spline would ring)", () => {
  const f = curveFunction([[0, 0], [0.4, 0.1], [0.5, 0.9], [1, 1]]);
  let previous = -1;
  for (let i = 0; i <= 1000; i++) {
    const v = f(i / 1000);
    check(v >= 0 && v <= 1, `out of range at ${i / 1000}: ${v}`);
    check(v >= previous - 1e-9, `not monotone at ${i / 1000}`);
    previous = v;
  }
});

// ---- details ----

const FLAT = image(256, 64, () => [118, 118, 118]);
const STEP = image(256, 64, (x) => (x < 128 ? [40, 40, 40] : [210, 210, 210]));
// Sharpening's radius scales with the image (0.06 % of the long edge), so it's tested at the
// editor's real preview size: 2048 px gives darktable's ~1.2 px.
const WIDE_STEP = image(2048, 16, (x) => (x < 1024 ? [40, 40, 40] : [210, 210, 210]));
const TEXTURE = image(256, 64, (x, y) => { const v = Math.round(128 + 40 * Math.sin(x / 2.1) * Math.sin(y / 2.7)); return [v, v, v]; });
const stddev = (pixels, width, height) => {
  let s = 0, s2 = 0, n = 0;
  for (let y = 8; y < height - 8; y++) for (let x = 8; x < width - 8; x++) { const v = px(pixels, width, x, y)[1]; s += v; s2 += v * v; n++; }
  return Math.sqrt(s2 / n - (s / n) ** 2);
};

test("structure and sharpening leave a flat image untouched", () => {
  for (const params of [{ structure: 100 }, { structure: -100 }, { sharpening: 100 }]) {
    const d = diff(render(FLAT, recipeOf(entry("details", params))), FLAT.pixels);
    check(d.max <= 1, `${JSON.stringify(params)}: max diff ${d.max}`);
  }
});

test("sharpening steepens an edge; structure + raises texture contrast, - flattens it", () => {
  const sharp = render(WIDE_STEP, recipeOf(entry("details", { sharpening: 100 })));
  const dark = px(sharp, 2048, 1023, 8)[1], bright = px(sharp, 2048, 1024, 8)[1];
  check(dark < 40 - 5 && bright > 210 + 5, `edge ${dark} | ${bright} (input 40 | 210)`);
  check(px(sharp, 2048, 900, 8)[1] === 40 && px(sharp, 2048, 1150, 8)[1] === 210, "sharpening changed pixels away from the edge");
  const base = stddev(TEXTURE.pixels, 256, 64);
  const more = stddev(render(TEXTURE, recipeOf(entry("details", { structure: 100 }))), 256, 64);
  const less = stddev(render(TEXTURE, recipeOf(entry("details", { structure: -100 }))), 256, 64);
  check(more > base * 1.15, `structure +100: stddev ${base.toFixed(2)} -> ${more.toFixed(2)}`);
  check(less < base * 0.9, `structure -100: stddev ${base.toFixed(2)} -> ${less.toFixed(2)}`);
});

test("structure +100 doesn't halo around a strong edge (edge-aware base layer)", () => {
  const out = render(STEP, recipeOf(entry("details", { structure: 100 })));
  let lowest = 255, highest = 0;
  for (let x = 0; x < 256; x++) { const v = px(out, 256, x, 32)[1]; lowest = Math.min(lowest, v); highest = Math.max(highest, v); }
  check(lowest >= 40 - 8 && highest <= 210 + 8, `overshoot: range ${lowest}..${highest} for a 40..210 step`);
});

// ---- the preview must predict the export ----

test("the same edit at two resolutions looks the same (spatial sizes scale with the image)", () => {
  const scene = (size) => image(size, size, (x, y) => {
    const u = x / size, v = y / size;
    const base = 30 + 190 * u;
    const blob = Math.hypot(u - 0.3, v - 0.6) < 0.15 ? 60 : 0;
    const val = Math.min(255, Math.round(base + blob + 25 * Math.sin(u * 40) * Math.sin(v * 30)));
    return [val, Math.round(val * 0.9), Math.round(val * 0.8)];
  });
  const recipe = recipeOf(entry("tune", { shadows: 60, highlights: -60, contrast: 30 }), entry("details", { structure: 60 }));
  const big = render(scene(512), recipe);
  const small = render(scene(256), recipe);
  let sum = 0, n = 0;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) for (let c = 0; c < 3; c++) {
    const avg = (px(big, 512, 2 * x, 2 * y)[c] + px(big, 512, 2 * x + 1, 2 * y)[c] + px(big, 512, 2 * x, 2 * y + 1)[c] + px(big, 512, 2 * x + 1, 2 * y + 1)[c]) / 4;
    sum += Math.abs(avg - px(small, 256, x, y)[c]);
    n++;
  }
  check(sum / n < 3, `mean difference ${(sum / n).toFixed(2)} levels`);
});


// ---- geometry ----

// Every pixel a distinct colour, so any wrong mapping shows up.
const LABELLED = image(7, 5, (x, y) => [x * 36, y * 60, 100 + x * 10 + y]);

// Loop-based references for the expected pixel mapping, written from the definitions (not from
// geometry.js): flip first, then clockwise quarter turns.
function referenceTurn(src, quarterTurns, flip) {
  let w = src.width, h = src.height;
  let get = (x, y) => px(src.pixels, src.width, flip ? src.width - 1 - x : x, y);
  for (let i = 0; i < quarterTurns; i++) {
    const prev = get, ph = h;
    get = (x, y) => prev(y, ph - 1 - x); // clockwise: output (x, y) shows input (y, h - 1 - x)
    [w, h] = [h, w];
  }
  return { width: w, height: h, get };
}

test("crop copies exactly the chosen pixels, and nothing else", () => {
  pipeline.setSource(PATTERN.canvas);
  const { width, height, pixels } = pipeline.renderToPixels(recipeOf(entry("crop", { rect: [0.25, 0.125, 0.5, 0.75] })));
  check(width === 128 && height === 6, `size ${width}x${height}`);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const got = px(pixels, width, x, y), want = px(PATTERN.pixels, 256, x + 64, y + 1);
    check(got.every((v, c) => v === want[c]), `(${x},${y}) is ${got}, want ${want}`);
  }
});

for (const [quarterTurns, flip] of [[1, false], [2, false], [3, false], [0, true], [1, true], [3, true]]) {
  test(`rotate ${quarterTurns * 90}°${flip ? " with flip" : ""} moves every pixel exactly where it belongs`, () => {
    pipeline.setSource(LABELLED.canvas);
    const { width, height, pixels } = pipeline.renderToPixels(recipeOf(entry("rotate", { quarterTurns, flip })));
    const ref = referenceTurn(LABELLED, quarterTurns, flip);
    check(width === ref.width && height === ref.height, `size ${width}x${height}, want ${ref.width}x${ref.height}`);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const got = px(pixels, width, x, y), want = ref.get(x, y);
      check(got.every((v, c) => v === want[c]), `(${x},${y}) is ${got}, want ${want}`);
    }
  });
}

test("straighten's auto-crop never shows a blank corner, and is as large as it can be", () => {
  for (const [w, h] of [[400, 300], [300, 400], [500, 500], [1600, 400]]) {
    for (let angle = -45; angle <= 45; angle += 5) {
      const m = rotationMapping(w, h, { quarterTurns: 0, flip: false, angle });
      const corners = [[0, 0], [m.width, 0], [m.width, m.height], [0, m.height]].map((c) => apply3(m.matrix, c));
      check(corners.every(([x, y]) => x >= -1 && x <= w + 1 && y >= -1 && y <= h + 1), `${w}x${h} at ${angle}°: a corner falls outside: ${JSON.stringify(corners)}`);
      if (angle !== 0) {
        const s = straightenScale(w, h, angle) * 1.02; // 2 % bigger must no longer fit
        const big = rotationMapping(w * 1.0, h * 1.0, { quarterTurns: 0, flip: false, angle });
        const grown = [[-0.01, -0.01], [1.01, -0.01], [1.01, 1.01], [-0.01, 1.01]].map(([u, v]) => apply3(big.matrix, [u * big.width * 1.02 / 1.0, v * big.height * 1.02 / 1.0]).map((n) => n));
        check(s > 0, "scale");
        check(grown.some(([x, y]) => x < -0.5 || x > w + 0.5 || y < -0.5 || y > h + 0.5), `${w}x${h} at ${angle}°: a 2 % larger crop still fits, so the crop isn't maximal`);
      }
    }
  }
});

test("a positive straighten angle turns the photo clockwise", () => {
  // A white dot right of centre on black: turning clockwise moves it down.
  const src = image(400, 300, (x, y) => (Math.hypot(x - 300, y - 150) < 6 ? [255, 255, 255] : [0, 0, 0]));
  pipeline.setSource(src.canvas);
  const { width, height, pixels } = pipeline.renderToPixels(recipeOf(entry("rotate", { angle: 10 })));
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (px(pixels, width, x, y)[1] > 128) { sx += x + 0.5; sy += y + 0.5; n++; }
  const cx = sx / n - width / 2, cy = sy / n - height / 2;
  const t = (10 * Math.PI) / 180, r = 100; // the dot is 100 px right of centre
  check(Math.abs(cx - r * Math.cos(t)) < 2 && Math.abs(cy - r * Math.sin(t)) < 2, `dot at (${cx.toFixed(1)}, ${cy.toFixed(1)}) from centre, want (${(r * Math.cos(t)).toFixed(1)}, ${(r * Math.sin(t)).toFixed(1)})`);
});

test("perspective vertical + straightens verticals that converge upwards, with no empty edges", () => {
  // A vertical line at a quarter of the width: after the correction it leans outwards at the top.
  const src = image(400, 300, (x) => (Math.abs(x + 0.5 - 100) < 2 ? [255, 255, 255] : [90, 90, 90]));
  pipeline.setSource(src.canvas);
  const { width, pixels } = pipeline.renderToPixels(recipeOf(entry("perspective", { vertical: 60 })));
  const lineX = (row) => { let s = 0, n = 0; for (let x = 0; x < width; x++) if (px(pixels, width, x, row)[1] > 170) { s += x; n++; } return s / n; };
  const top = lineX(2), bottom = lineX(297);
  check(top < bottom - 10, `line at x=${top.toFixed(1)} (top) vs ${bottom.toFixed(1)} (bottom)`);
  check(Math.abs(bottom - 100) < 2, `bottom of the line moved to ${bottom.toFixed(1)}`);
  for (const [x, y] of [[0, 0], [399, 0], [0, 299], [399, 299]]) check(px(pixels, width, x, y)[1] > 60, `corner (${x},${y}) is empty: ${px(pixels, width, x, y)}`);
});

test("tools after a crop work on the cropped image (sizes follow the geometry)", () => {
  pipeline.setSource(GRADIENT.canvas);
  const { width, height, values } = pipeline.renderToFloats(recipeOf(entry("crop", { rect: [0, 0, 0.5, 0.5] }), entry("tune", { shadows: 80 }), entry("details", { structure: 50 }), entry("rotate", { quarterTurns: 1 })));
  check(width === 32 && height === 256, `size ${width}x${height}`);
  check(values.every(Number.isFinite), "non-finite values");
});

test("geometry gives the same picture at two resolutions", () => {
  const scene = (size) => image(size, Math.round(size * 0.75), (x, y) => {
    const u = x / size, v = y / (size * 0.75);
    return [Math.round(255 * u), Math.round(255 * v), Math.round(128 + 100 * Math.sin(u * 12) * Math.cos(v * 9))];
  });
  const recipe = recipeOf(entry("crop", { rect: [0.1, 0.05, 0.8, 0.9] }), entry("rotate", { angle: 7 }), entry("perspective", { vertical: 40, horizontal: -30 }));
  pipeline.setSource(scene(512).canvas);
  const big = pipeline.renderToPixels(recipe);
  pipeline.setSource(scene(256).canvas);
  const small = pipeline.renderToPixels(recipe);
  // Each step rounds to whole pixels, so the sizes can be a pixel or two off an exact 2x. Compare
  // through the actual scale between them.
  check(Math.abs(big.width / 2 - small.width) <= 2 && Math.abs(big.height / 2 - small.height) <= 2, `sizes ${big.width}x${big.height} vs ${small.width}x${small.height}`);
  const sx = big.width / small.width, sy = big.height / small.height;
  let sum = 0, n = 0;
  for (let y = 1; y < small.height - 1; y++) for (let x = 1; x < small.width - 1; x++) for (let c = 0; c < 3; c++) {
    const bx = Math.min(big.width - 2, Math.round((x + 0.5) * sx - 1)), by = Math.min(big.height - 2, Math.round((y + 0.5) * sy - 1));
    const avg = [[0, 0], [1, 0], [0, 1], [1, 1]].reduce((a, [dx, dy]) => a + px(big.pixels, big.width, bx + dx, by + dy)[c], 0) / 4;
    sum += Math.abs(avg - px(small.pixels, small.width, x, y)[c]);
    n++;
  }
  check(sum / n < 4, `mean difference ${(sum / n).toFixed(2)} levels`);
});


// ---- looks ----

test("vignette darkens the corners, leaves the centre, and inner brightness lifts the centre", () => {
  const flat = image(400, 300, () => [150, 150, 150]);
  const outer = render(flat, recipeOf(entry("vignette", { outer: -80 })));
  const both = render(flat, recipeOf(entry("vignette", { outer: -80, inner: 60 })));
  const centre = px(outer, 400, 200, 150)[1], corner = px(outer, 400, 3, 3)[1];
  check(Math.abs(centre - 150) <= 1, `centre moved to ${centre}`);
  check(corner < 150 - 40, `corner only ${corner}`);
  check(px(both, 400, 200, 150)[1] > 150 + 10, `inner brightness: centre ${px(both, 400, 200, 150)[1]}`);
  for (let x = 200; x < 399; x++) check(px(outer, 400, x + 1, 150)[1] <= px(outer, 400, x, 150)[1] + 1, `not falling off smoothly at x=${x}`);
});

test("vignette outer + lightens the edges towards white", () => {
  const out = render(image(400, 300, () => [60, 60, 60]), recipeOf(entry("vignette", { outer: 100 })));
  check(px(out, 400, 2, 2)[1] > 200, `corner ${px(out, 400, 2, 2)}`);
});

test("black & white is neutral, keeps black and white, and each film reads colours differently", () => {
  const results = {};
  for (const film of ["luminance", "hp5", "acros"]) {
    const out = render(PATTERN, recipeOf(entry("blackwhite", { film })));
    for (let x = 0; x < 256; x += 15) for (const row of [1, 2, 3, 4, 5]) {
      const [r, g, b] = px(out, 256, x, row);
      check(Math.max(r, g, b) - Math.min(r, g, b) <= 1, `${film}: not grey at (${x},${row}): ${[r, g, b]}`);
    }
    check(Math.max(...px(out, 256, 10, ROW.black)) <= 1 && Math.min(...px(out, 256, 10, ROW.white)) >= 254, `${film}: black/white moved`);
    results[film] = [px(out, 256, 255, 1)[0], px(out, 256, 255, 3)[0]]; // pure red, pure blue
  }
  // Luminance renders red brighter than blue. The Ilford films are more blue-sensitive.
  check(results.luminance[0] > results.luminance[1], `luminance: red ${results.luminance[0]} vs blue ${results.luminance[1]}`);
  check(results.hp5[1] > results.luminance[1] + 10, `HP5+ blue ${results.hp5[1]} not brighter than luminance's ${results.luminance[1]}`);
});

test("a red filter darkens blues and lightens reds, but leaves greys alone", () => {
  const scene = image(240, 80, (x) => (x < 80 ? [200, 40, 40] : x < 160 ? [40, 80, 200] : [128, 128, 128]));
  const none = render(scene, recipeOf(entry("blackwhite", { filter: "none" })));
  const red = render(scene, recipeOf(entry("blackwhite", { filter: "red" })));
  const at = (pixels, x) => px(pixels, 240, x, 40)[0];
  check(at(red, 40) > at(none, 40) + 5, `red patch ${at(none, 40)} -> ${at(red, 40)}`);
  check(at(red, 120) < at(none, 120) - 5, `blue patch ${at(none, 120)} -> ${at(red, 120)}`);
  check(Math.abs(at(red, 200) - at(none, 200)) <= 2, `grey patch ${at(none, 200)} -> ${at(red, 200)}`);
});

test("grain adds texture to midtones, is the same on every render, and stays finite", () => {
  const grey = image(512, 384, () => [128, 128, 128]);
  const a = render(grey, recipeOf(entry("blackwhite", { grain: 80 })));
  const b = render(grey, recipeOf(entry("blackwhite", { grain: 80 })));
  check(diff(a, b).max === 0, "grain differs between renders");
  check(stddev(a, 512, 384) > 1.5, `grain stddev only ${stddev(a, 512, 384).toFixed(2)}`);
  pipeline.setSource(PATTERN.canvas);
  check(pipeline.renderToFloats(recipeOf(entry("blackwhite", { grain: 100, contrast: 100, filter: "blue" }))).values.every(Number.isFinite), "non-finite values");
});

// ---- engine invariants ----

test("rendering is deterministic, and the texture pool stops growing", () => {
  const recipe = recipeOf(...TOOL_ORDER.map((id) => entry(id, Object.fromEntries(TOOLS[id].params.filter((p) => !p.kind).map((p) => [p.id, Math.min(p.max, 40)])))),
    entry("crop", { rect: [0.1, 0.1, 0.7, 0.8] }), entry("rotate", { quarterTurns: 1, angle: 3 }));
  const first = render(PATTERN, recipe);
  const poolAfterFirst = pipeline.pool.size();
  for (let i = 0; i < 20; i++) pipeline.renderToPixels(recipe);
  const last = pipeline.renderToPixels(recipe).pixels;
  check(diff(first, last).max === 0, "two renders of the same recipe differ");
  check(pipeline.pool.size() === poolAfterFirst, `pool grew from ${poolAfterFirst} to ${pipeline.pool.size()} textures`);
});

// ---- recipes ----

test("loadRecipe fills defaults, clamps, drops unknown params, and refuses unknown tools and newer versions", () => {
  const loaded = loadRecipe({ version: 1, stack: [{ tool: "tune", params: { brightness: 500, bogus: 3 } }, { tool: "curves", params: { points: { rgb: [[0, 0], [0.5]] } } }] });
  check(loaded.stack[0].params.brightness === 100, "brightness not clamped to 100");
  check(loaded.stack[0].params.contrast === 0, "missing contrast not defaulted");
  check(!("bogus" in loaded.stack[0].params), "unknown param kept");
  check(JSON.stringify(loaded.stack[1].params.points.rgb) === JSON.stringify(IDENTITY_CURVE), "invalid curve not replaced");
  const throws = (raw) => { try { loadRecipe(raw); return false; } catch (e) { return e instanceof RecipeError; } };
  check(throws({ version: 1, stack: [{ tool: "teleport", params: {} }] }), "unknown tool accepted");
  check(throws({ version: RECIPE_VERSION + 1, stack: [] }), "newer version accepted");
  check(throws({ stack: [] }), "missing version accepted");
  const geo = loadRecipe({ version: 1, stack: [
    { tool: "crop", params: { rect: [0.5, 0.5, 0.9, 0.2], aspect: "7:3" } },
    { tool: "rotate", params: { quarterTurns: 5, flip: "yes", angle: 99 } },
  ] });
  check(JSON.stringify(geo.stack[0].params.rect) === "[0,0,1,1]", `crop running off the image not reset: ${geo.stack[0].params.rect}`);
  check(geo.stack[0].params.aspect === "free", "unknown aspect kept");
  check(geo.stack[1].params.quarterTurns === 1 && geo.stack[1].params.flip === false && geo.stack[1].params.angle === 45, `rotate not normalised: ${JSON.stringify(geo.stack[1].params)}`);
});

// ---- run ----

const rows = document.getElementById("results");
let passed = 0, failed = 0;
const results = [];
for (const { name, fn } of tests) {
  let error = null;
  const started = performance.now();
  try { await fn(); passed++; } catch (e) { error = e; failed++; }
  const ms = Math.round(performance.now() - started);
  results.push({ name, ok: !error, message: error ? String(error.message ?? error) : null, ms });
  const tr = rows.insertRow();
  tr.insertCell().innerHTML = error ? '<span class="fail">FAIL</span>' : '<span class="pass">PASS</span>';
  const cell = tr.insertCell();
  cell.textContent = `${name} (${ms} ms)`;
  if (error) {
    const d = document.createElement("div");
    d.className = "detail";
    d.textContent = error instanceof Failure ? error.message : (error.stack ?? String(error));
    cell.append(d);
  }
}
document.getElementById("summary").innerHTML = `<span class="${failed ? "fail" : "pass"}">${passed} passed, ${failed} failed</span>`;
window.__pipelineTests = { passed, failed, results };
