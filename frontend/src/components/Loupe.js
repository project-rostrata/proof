import van from "../../lib/van-1.6.1.js";
import { state } from "../state.js";
import { CullControls } from "./CullControls.js";
import { emptyNode } from "../vanHelpers.js";

const { div, img, button, span } = van.tags;

// Gap between neighbouring photos while swiping, in CSS px (matches .loupe-slide in style.css).
const SLIDE_GAP = 16;

// When the page is pinch-zoomed (to check focus on a phone), one-finger drags must pan the zoomed
// view rather than change photos: swipes are ignored, and style.css relaxes the stage's
// touch-action under .is-zoomed. One listener for the app's lifetime.
const isZoomed = () => (window.visualViewport?.scale ?? 1) > 1.01;
window.visualViewport?.addEventListener("resize", () => document.documentElement.classList.toggle("is-zoomed", isZoomed()));

// Full-screen single-photo view over the contact sheet. It shows the 2048 px preview on a strip
// with the neighbours' previews either side (off-screen until a swipe brings one in), so they're
// already loaded and stepping through a shoot doesn't wait on the network.
export function Loupe() {
  return () => {
    if (!state.loupeOpen.val) return emptyNode();
    const index = state.selected.val;
    const photos = state.photos.val;
    const photo = photos[index]?.rawVal; // static fields only; the badges below subscribe to cull changes
    if (!photo) return emptyNode();
    const step = (d) => { state.selected.val = Math.max(0, Math.min(photos.length - 1, index + d)); };
    const slide = (i, position) => photos[i] && div({ class: `loupe-slide is-${position}` },
      img({ class: "loupe-image", src: () => photos[i].val.previewUrl, alt: position === "current" ? photo.filename : "", draggable: false }));
    const strip = div({ class: "loupe-strip" }, slide(index - 1, "prev"), slide(index, "current"), slide(index + 1, "next"));
    const gesture = swipeable(strip, { canStep: (d) => photos[index + d] !== undefined, step });
    return div(
      { class: "loupe", role: "dialog", "aria-label": photo.filename },
      // A tap beside the photo closes the loupe, but not the click some browsers send after a swipe.
      div({ class: "loupe-stage", onclick: (e) => { if (e.target.tagName !== "IMG" && !gesture.justSwiped(e)) state.loupeOpen.val = false; } },
        strip),
      button({ class: "loupe-nav loupe-prev", "aria-label": "Previous", disabled: index === 0, onclick: () => step(-1) }, "‹"),
      button({ class: "loupe-nav loupe-next", "aria-label": "Next", disabled: index === photos.length - 1, onclick: () => step(1) }, "›"),
      div(
        { class: "loupe-info" },
        CullControls(photos[index]),
        div({ class: "loupe-details", title: [photo.filename, photo.captureDisplay, photo.cameraDisplay, photo.exposureDisplay].filter(Boolean).join("\n") },
          span({ class: "loupe-name" }, photo.filename),
          span({ class: "loupe-meta" }, [photo.captureDisplay, photo.cameraDisplay, photo.exposureDisplay].filter(Boolean).join("  ·  "))),
        span({ class: "loupe-keys" }, "1–5 rate · P pick · X reject · ← → next"),
        span({ class: "loupe-position" }, `${index + 1} / ${photos.length}`),
        button({ class: "btn-primary btn-small", onclick: () => { state.editing.val = photos[index]; } }, "Edit"),
        button({ class: "btn-ghost btn-small", onclick: () => { state.loupeOpen.val = false; } }, "Close"),
      ),
    );
  };
}

// One-finger horizontal swipes between photos, following the finger: the neighbour slides in
// beside the current photo. Letting go past a fifth of the width, or with a flick, moves to it;
// otherwise the strip springs back. Past the first or last photo the drag resists and never moves.
// Touch and pen only: with a mouse, the arrow keys and the ‹ › buttons do this. The drag offset is
// set on the strip's style directly, since it's per-frame presentation, not app state.
function swipeable(strip, { canStep, step }) {
  let drag = null; // { id, x, y, horizontal, lastX, lastT, velocity }
  let offset = 0;
  let swipedAt = -Infinity;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const settle = (to, then) => {
    const from = offset;
    offset = 0;
    strip.style.transform = `translateX(${to}px)`;
    if (reduceMotion) return then();
    strip.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }],
      { duration: 180, easing: "cubic-bezier(.2,.7,.3,1)" }).onfinish = then;
  };
  const springBack = () => settle(0, () => { strip.style.transform = ""; });
  const cancel = () => { if (drag?.horizontal) springBack(); drag = null; };

  strip.addEventListener("pointerdown", (e) => {
    if (drag) return cancel(); // a second finger: this is a pinch, not a swipe
    if (e.pointerType === "mouse" || isZoomed()) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, horizontal: null, lastX: e.clientX, lastT: e.timeStamp, velocity: 0 };
  });
  strip.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (drag.horizontal === null) {
      if (Math.hypot(dx, dy) < 10) return; // not a drag yet
      drag.horizontal = Math.abs(dx) > Math.abs(dy);
      if (drag.horizontal) strip.setPointerCapture(e.pointerId);
    }
    if (!drag.horizontal) return;
    const dt = e.timeStamp - drag.lastT;
    if (dt > 0) drag.velocity = 0.7 * ((e.clientX - drag.lastX) / dt) + 0.3 * drag.velocity; // px/ms, smoothed
    drag.lastX = e.clientX;
    drag.lastT = e.timeStamp;
    offset = canStep(dx < 0 ? 1 : -1) ? dx : dx / 3;
    strip.style.transform = `translateX(${offset}px)`;
  });
  strip.addEventListener("pointerup", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { horizontal, velocity } = drag;
    drag = null;
    if (!horizontal) return;
    swipedAt = e.timeStamp;
    const d = offset < 0 ? 1 : -1;
    const flicked = Math.abs(velocity) > 0.4 && Math.sign(velocity) === -d && Math.abs(offset) > 30;
    if (canStep(d) && (Math.abs(offset) > strip.clientWidth / 5 || flicked)) {
      settle(-d * (strip.clientWidth + SLIDE_GAP), () => step(d));
    } else {
      springBack();
    }
  });
  strip.addEventListener("pointercancel", (e) => { if (drag && e.pointerId === drag.id) cancel(); });

  return { justSwiped: (e) => e.timeStamp - swipedAt < 400 };
}
