import van from "../../../lib/van-1.6.1.js";
import { TOOLS } from "../../pipeline/ops/index.js";

// The open tool: one stack entry being adjusted, as in Snapseed, where each use of a tool is one
// edit layer. Its *picks* are what the photo gestures work on: every plain slider, plus the crop box
// for Crop & Rotate. One pick is active at a time. A slider is changed by dragging sideways or
// scrolling on the photo, and the crop box by dragging its corners and edges (gestures.js).
//
// `shown` mirrors each slider's value as a van state, for everything that displays it (the panel's
// slider, the pill on the photo, the phone's list), so changing it from one place updates the rest.
// `before` is the entry as it was when opened, so ✕ can put it back (or drop a new entry).
export function openTool(entry, isNew) {
  const tool = TOOLS[entry.tool];
  const picks = tool.params.flatMap((spec) => {
    if (!spec.kind) return [{ id: spec.id, label: spec.label, spec }];
    if (spec.kind === "rect") return [{ id: spec.id, label: spec.label, crop: true }];
    return [];
  });
  const shown = new Map(picks.filter((p) => p.spec).map((p) => [p.id, van.state(entry.params[p.id])]));
  const active = van.state(picks[0]?.id ?? null);
  const activePick = () => picks.find((p) => p.id === active.val) ?? null;

  return {
    entry,
    tool,
    picks,
    shown,
    active,
    isNew,
    before: structuredClone(entry.params),
    activeSlider: () => activePick()?.spec ?? null,
    cropActive: () => !!activePick()?.crop,
    // Sets a slider, rounded to its step and clamped to its range. Returns whether it changed.
    setValue(spec, value) {
      const step = spec.step ?? 1;
      const v = Number(Math.min(spec.max, Math.max(spec.min, Math.round(value / step) * step)).toFixed(step < 1 ? 1 : 0));
      if (v === entry.params[spec.id]) return false;
      entry.params[spec.id] = v;
      shown.get(spec.id).val = v;
      return true;
    },
  };
}
