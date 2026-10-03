import van from "../../lib/van-1.6.1.js";

const { div } = van.tags;

// A fine alignment grid over the live result while Rotate or Perspective is selected, to line up
// horizons and verticals against.
export function GridOverlay() {
  return div({ class: "grid-overlay" });
}
