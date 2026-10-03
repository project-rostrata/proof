import van from "../../lib/van-1.6.1.js";
import { MoonIcon, SunIcon } from "../icons.js";
import { theme, toggleTheme } from "../theme.js";

const { footer, button, span } = van.tags;

// Bottom of the signed-in pages, as in larder. Only the light/dark toggle: it's rarely used, so
// it lives here rather than competing for room in the top bar on phones. The button names what a
// click switches to. A click doesn't take focus, so Enter and Space go on opening the loupe
// (cull.js) instead of pressing this button again. The loupe and editor stay dark either way.
export function Footer() {
  return footer(
    { class: "app-footer" },
    button(
      { class: "theme-toggle", onmousedown: (e) => e.preventDefault(), onclick: toggleTheme },
      () => (theme.val === "light" ? MoonIcon() : SunIcon()),
      span(() => (theme.val === "light" ? "Dark mode" : "Light mode")),
    ),
  );
}
