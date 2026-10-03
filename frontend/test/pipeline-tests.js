// Pipeline tests (AGENTS.md "Testing"). Every tool must be an exact identity at its defaults, and
// stay finite and in range at its extremes. Each tool's maths is checked against a CPU reference,
// or against the property it promises (monotone, endpoints kept, neutral stays neutral, preview
// matches export). Results go into the page and window.__pipelineTests (for headless runs).
import { Pipeline } from "../src/pipeline/runner.js";
import { TOOLS, TOOL_ORDER } from "../src/pipeline/ops/index.js";
import { loadRecipe, newEntry, emptyRecipe, RecipeError, RECIPE_VERSION } from "../src/pipeline/recipe.js";
import { curveFunction, IDENTITY_CURVE } from "../src/pipeline/curve.js";
import { shape } from "../src/pipeline/ops/shared.js";

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

for (const id of TOOL_ORDER) {
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
    for (const spec of TOOLS[id].params.filter((p) => p.kind !== "curves")) {
      for (const value of [spec.min, spec.max]) {
        const { values } = pipeline.renderToFloats(recipeOf(entry(id, { [spec.id]: value })));
        const bad = values.findIndex((v) => !Number.isFinite(v));
        check(bad < 0, `${id}.${spec.id}=${value}: non-finite value at index ${bad}`);
      }
    }
  }
  const everything = recipeOf(...TOOL_ORDER.map((id) => entry(id, Object.fromEntries(TOOLS[id].params.filter((p) => p.kind !== "curves").map((p) => [p.id, p.max])))));
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

// ---- engine invariants ----

test("rendering is deterministic, and the texture pool stops growing", () => {
  const recipe = recipeOf(...TOOL_ORDER.map((id) => entry(id, id === "curves" ? {} : Object.fromEntries(TOOLS[id].params.map((p) => [p.id, 40])))));
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
