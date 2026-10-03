// Minimal inline-SVG icons with the same icon() helper as shelf's and larder's: no icon library.
// Only the icons proof actually uses.
import van from "../lib/van-1.6.1.js";

const { svg, path } = van.tags("http://www.w3.org/2000/svg");

function icon(children) {
  return (props = {}) =>
    svg(
      {
        viewBox: "0 0 24 24",
        width: props.size ?? 16,
        height: props.size ?? 16,
        fill: "none",
        stroke: props.color ?? "currentColor",
        "stroke-width": props.strokeWidth ?? 1.8,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      },
      ...children(),
    );
}

export const SunIcon = icon(() => [
  path({ d: "M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8Z" }),
  path({ d: "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" }),
]);
export const MoonIcon = icon(() => [path({ d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" })]);
