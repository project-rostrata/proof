import { tune } from "./tune.js";
import { whitebalance } from "./whitebalance.js";
import { curves } from "./curves.js";
import { details } from "./details.js";
import { crop } from "./crop.js";
import { rotate } from "./rotate.js";
import { perspective } from "./perspective.js";

// Every tool a recipe can name. A tool's `id` is written into saved recipes, so it never changes
// (AGENTS.md).
export const TOOLS = Object.fromEntries([tune, whitebalance, curves, details, crop, rotate, perspective].map((t) => [t.id, t]));

// The order tools are offered in the editor (Snapseed's grouping: tone first, then geometry).
export const TOOL_ORDER = ["tune", "details", "curves", "whitebalance", "crop", "rotate", "perspective"];
