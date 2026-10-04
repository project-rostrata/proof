import { tune } from "./tune.js";
import { curves } from "./curves.js";
import { details } from "./details.js";
import { cropRotate } from "./crop-rotate.js";
import { vignette } from "./vignette.js";
import { blackwhite } from "./blackwhite.js";

// Every tool a recipe can name. A tool's `id` is written into saved recipes, so it never changes
// once proof is deployed (AGENTS.md).
export const TOOLS = Object.fromEntries([tune, details, curves, cropRotate, vignette, blackwhite].map((t) => [t.id, t]));

// The tools in the order the editor offers them, under Snapseed-style headings.
export const TOOL_GROUPS = [
  { label: "Adjust", tools: ["tune", "details", "curves"] },
  { label: "Geometry", tools: ["croprotate"] },
  { label: "Looks", tools: ["vignette", "blackwhite"] },
];
export const TOOL_ORDER = TOOL_GROUPS.flatMap((g) => g.tools);
