// The recipe: what the browser saves next to a render, and the only thing proof's frontend reads
// back to reopen an edit (PROJECT_BRIEF.md §4). The server treats it as opaque JSON.
//
//   { "version": 1, "stack": [ { "tool": "tune", "params": { "brightness": 12, ... } }, ... ] }
//
// Parameters are stored in slider units (-100..100 or 0..100), not shader units, so the maths can
// change without invalidating saved recipes. If a change *would* alter what a stored recipe
// renders, bump RECIPE_VERSION and add a step to MIGRATIONS (AGENTS.md).
import { TOOLS } from "./ops/index.js";

export const RECIPE_VERSION = 1;

// MIGRATIONS[n] upgrades a version-n recipe to version n+1. None yet.
const MIGRATIONS = {};

export class RecipeError extends Error {}

export function emptyRecipe() {
  return { version: RECIPE_VERSION, stack: [] };
}

function defaultsFor(toolId) {
  const tool = TOOLS[toolId];
  if (!tool) throw new RecipeError(`unknown tool "${toolId}"`);
  return Object.fromEntries(tool.params.map((p) => [p.id, structuredClone(p.default)]));
}

export function newEntry(toolId) {
  return { tool: toolId, params: defaultsFor(toolId) };
}

function validCurve(points) {
  return Array.isArray(points) && points.length >= 2 && points.length <= 16 &&
    points.every((p, i) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && v >= 0 && v <= 1) &&
      (i === 0 || p[0] > points[i - 1][0]));
}

function validRect(r) {
  return Array.isArray(r) && r.length === 4 && r.every((v) => typeof v === "number" && Number.isFinite(v)) &&
    r[0] >= 0 && r[1] >= 0 && r[2] >= 0.01 && r[3] >= 0.01 && r[0] + r[2] <= 1 + 1e-9 && r[1] + r[3] <= 1 + 1e-9;
}

function normalizeParam(spec, value) {
  if (spec.kind === "rect") return validRect(value) ? [...value] : [...spec.default];
  if (spec.kind === "choice") return spec.options.includes(value) ? value : spec.default;
  if (spec.kind === "toggle") return typeof value === "boolean" ? value : spec.default;
  if (spec.kind === "turns") return Number.isInteger(value) ? ((value % 4) + 4) % 4 : spec.default;
  if (spec.kind === "curves") {
    const curves = {};
    for (const channel of Object.keys(spec.default)) {
      curves[channel] = validCurve(value?.[channel]) ? value[channel].map((p) => [p[0], p[1]]) : structuredClone(spec.default[channel]);
    }
    return curves;
  }
  return typeof value === "number" && Number.isFinite(value) ? Math.min(spec.max, Math.max(spec.min, value)) : spec.default;
}

// Brings any stored recipe up to the current version and shape: older versions migrated, missing
// parameters defaulted, out-of-range values clamped, unknown parameters dropped. Unknown tools and
// newer versions are errors: guessing would render something the user didn't make.
export function loadRecipe(raw) {
  if (!raw || typeof raw !== "object" || !Number.isInteger(raw.version) || !Array.isArray(raw.stack)) {
    throw new RecipeError("not a proof recipe");
  }
  if (raw.version > RECIPE_VERSION) throw new RecipeError(`this edit was made by a newer version of proof (recipe v${raw.version})`);
  let recipe = structuredClone(raw);
  while (recipe.version < RECIPE_VERSION) {
    const migrate = MIGRATIONS[recipe.version];
    if (!migrate) throw new RecipeError(`no migration from recipe v${recipe.version}`);
    recipe = migrate(recipe);
  }
  return {
    version: RECIPE_VERSION,
    stack: recipe.stack.map((entry) => {
      const tool = TOOLS[entry?.tool];
      if (!tool) throw new RecipeError(`unknown tool "${entry?.tool}"`);
      return { tool: tool.id, params: Object.fromEntries(tool.params.map((spec) => [spec.id, normalizeParam(spec, entry.params?.[spec.id])])) };
    }),
  };
}
