import van from "../../lib/van-1.6.1.js";
import { state } from "../state.js";
import { Stars, FlagBadge, LabelDot } from "./CullBadges.js";
import { emptyNode } from "../vanHelpers.js";

const { div, img, button, span, link } = van.tags;

// Full-screen single-photo view over the contact sheet. It shows the 2048 px preview and preloads
// the neighbours' previews, so stepping through a shoot doesn't wait on the network.
export function Loupe() {
  return () => {
    if (!state.loupeOpen.val) return emptyNode();
    const index = state.selected.val;
    const photos = state.photos.val;
    const photo = photos[index]?.rawVal; // static fields only; the badges below subscribe to cull changes
    if (!photo) return emptyNode();
    const step = (d) => { state.selected.val = Math.max(0, Math.min(photos.length - 1, index + d)); };
    const neighbours = [photos[index - 1], photos[index + 1]].filter(Boolean).map((p) => link({ rel: "preload", as: "image", href: p.rawVal.previewUrl }));
    return div(
      { class: "loupe", role: "dialog", "aria-label": photo.filename },
      ...neighbours,
      div({ class: "loupe-stage", onclick: (e) => { if (e.target === e.currentTarget) state.loupeOpen.val = false; } },
        img({ class: "loupe-image", src: photo.previewUrl, alt: photo.filename })),
      button({ class: "loupe-nav loupe-prev", "aria-label": "Previous", disabled: index === 0, onclick: () => step(-1) }, "‹"),
      button({ class: "loupe-nav loupe-next", "aria-label": "Next", disabled: index === photos.length - 1, onclick: () => step(1) }, "›"),
      div(
        { class: "loupe-info" },
        div({ class: "loupe-cull" }, () => {
          const p = photos[index].val; // re-render on this photo's own cull changes
          return span({ class: "loupe-badges" }, FlagBadge(p.flag), Stars(p.rating), LabelDot(p.label));
        }),
        span({ class: "loupe-name" }, photo.filename),
        span({ class: "loupe-meta" }, [photo.captureDisplay, photo.cameraDisplay, photo.exposureDisplay].filter(Boolean).join("  ·  ")),
        span({ class: "loupe-position" }, `${index + 1} / ${photos.length}`),
        button({ class: "btn-primary btn-small", onclick: () => { state.editing.val = photos[index]; } }, "Edit"),
        button({ class: "btn-ghost btn-small", onclick: () => { state.loupeOpen.val = false; } }, "Close"),
      ),
    );
  };
}
