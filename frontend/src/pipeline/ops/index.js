import { tune } from "./tune.js";
import { whitebalance } from "./whitebalance.js";
import { curves } from "./curves.js";
import { details } from "./details.js";

// Every tool a recipe can name. A tool's `id` is written into saved recipes, so it never changes
// (AGENTS.md).
export const TOOLS = Object.fromEntries([tune, whitebalance, curves, details].map((t) => [t.id, t]));

// The order tools are offered in the editor.
export const TOOL_ORDER = ["tune", "whitebalance", "curves", "details"];
