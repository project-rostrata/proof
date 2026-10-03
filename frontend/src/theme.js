// The footer's light/dark toggle. /theme.js (loaded in <head>) owns applying the theme; this
// mirrors <html data-theme> into a van state for the button's icon and label, and writes the
// user's explicit choice. A MutationObserver keeps the state in step when theme.js re-applies
// the system theme, so there's one source of truth: the attribute. Same as larder's.
import van from "../lib/van-1.6.1.js";

const KEY = "proof-theme";
const root = document.documentElement;

export const theme = van.state(root.dataset.theme === "light" ? "light" : "dark");

new MutationObserver(() => {
  theme.val = root.dataset.theme === "light" ? "light" : "dark";
}).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

export function toggleTheme() {
  const next = theme.val === "light" ? "dark" : "light";
  try {
    localStorage.setItem(KEY, next);
  } catch (e) {
    // storage blocked: the switch still applies for this page load, it just won't be remembered
  }
  root.dataset.theme = next;
}
