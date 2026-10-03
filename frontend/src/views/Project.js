import van from "../../lib/van-1.6.1.js";
import { state } from "../state.js";
import { navigate, setFilter } from "../router.js";
import { uploadFiles } from "../upload.js";
import { KEY_HELP } from "../cull.js";
import { Stars, FlagBadge } from "../components/CullBadges.js";
import { Loupe } from "../components/Loupe.js";
import { emptyNode } from "../vanHelpers.js";

const { main, section, div, h1, span, button, input, label, img, figure, figcaption, progress, p, select, option } = van.tags;

function UploadPanel() {
  return () => {
    const uploads = state.uploads.val.filter((u) => u.projectId === state.projectId.val);
    if (!uploads.length) return emptyNode();
    const done = uploads.filter((u) => u.status === "done").length;
    const failed = uploads.filter((u) => u.status === "failed").length;
    return section(
      { class: "upload-panel", "aria-live": "polite" },
      div({ class: "upload-summary" }, `${done} of ${uploads.length} uploaded` + (failed ? ` · ${failed} failed` : "")),
      div(
        { class: "upload-list" },
        ...uploads.filter((u) => u.status !== "done").map((u) =>
          div(
            { class: `upload-row upload-${u.status}` },
            span({ class: "upload-name" }, u.file.name),
            u.status === "failed" ? span({ class: "upload-error" }, u.error) : progress({ max: u.total || 1, value: u.loaded }),
          )),
      ),
    );
  };
}

// View tabs and counts come from the API (views[]); the client only asks for a different view.
function FilterBar() {
  return () => {
    const current = state.current.val;
    if (!current) return emptyNode();
    return div(
      { class: "filter-bar" },
      div(
        { class: "view-tabs", role: "tablist" },
        ...current.views.map((v) =>
          button(
            {
              class: v.id === current.view ? "view-tab is-active" : "view-tab", role: "tab", "aria-selected": v.id === current.view,
              onclick: () => setFilter({ view: v.id, minRating: current.minRating }),
            },
            v.label, span({ class: "view-count" }, String(v.count)),
          )),
      ),
      select(
        { class: "field-input rating-filter", "aria-label": "Minimum rating", onchange: (e) => setFilter({ view: current.view, minRating: Number(e.target.value) }) },
        ...[0, 1, 2, 3, 4, 5].map((n) => option({ value: n, selected: n === current.minRating }, n === 0 ? "Any rating" : `${"★".repeat(n)} and up`)),
      ),
      span({ class: "key-help" }, KEY_HELP),
    );
  };
}

// Only the class and the badges react to cull changes. The image node stays put, so rating a photo
// never re-creates (and flickers) its thumbnail. Static fields are read with rawVal so the frame
// doesn't subscribe to them.
function Frame(photoState, index) {
  const photo = photoState.rawVal;
  return figure(
    {
      class: () => `frame${state.selected.val === index ? " is-selected" : ""}${photoState.val.flag === "reject" ? " is-rejected" : ""}`,
      title: [photo.filename, photo.captureDisplay, photo.cameraDisplay, photo.exposureDisplay].filter(Boolean).join("\n"),
      onclick: () => { state.selected.val = index; },
      ondblclick: () => { state.selected.val = index; state.loupeOpen.val = true; },
    },
    // src is bound to the photo's state, so a saved edit's new (versioned) thumbnail URL replaces
    // the old one. Cull changes keep the same URL, so the image isn't reloaded.
    div({ class: "frame-image" }, img({ src: () => photoState.val.thumbUrl, alt: photo.filename, loading: "lazy", decoding: "async" })),
    () => {
      const p = photoState.val;
      return div({ class: "frame-cull" }, FlagBadge(p.flag), Stars(p.rating), p.hasEdit ? span({ class: "edited-badge", title: "Edited" }, "✎") : "");
    },
    figcaption(photo.filename),
  );
}

function ContactSheet() {
  return () => {
    const photos = state.photos.val;
    const current = state.current.val;
    if (!photos.length) {
      const filtered = current && (current.view !== "all" || current.minRating > 0);
      return p({ class: "empty-state" }, filtered
        ? "No photos match this view."
        : "No photos yet. Drop JPEG or PNG files anywhere on this page, or use Add photos.");
    }
    return div({ class: "contact-sheet" }, ...photos.map(Frame));
  };
}

export function Project() {
  const dragging = van.state(false);
  const onFiles = (files) => uploadFiles(state.projectId.val, files);

  return main(
    {
      class: () => `page${dragging.val ? " is-dragging" : ""}`,
      ondragover: (e) => { e.preventDefault(); dragging.val = true; },
      ondragleave: (e) => { if (e.target === e.currentTarget) dragging.val = false; },
      ondrop: (e) => { e.preventDefault(); dragging.val = false; onFiles(e.dataTransfer.files); },
    },
    section(
      { class: "page-header" },
      button({ class: "btn-ghost btn-small", onclick: () => navigate(null) }, "← Projects"),
      () => {
        const current = state.current.val;
        return current
          ? div({ class: "page-title" }, h1(current.project.name), span({ class: "page-subtitle" }, current.project.photoCountDisplay))
          : div({ class: "page-title" }, h1("Loading…"));
      },
      label(
        { class: "btn-primary" },
        "Add photos",
        input({ type: "file", multiple: true, accept: "image/jpeg,image/png", class: "visually-hidden", onchange: (e) => { onFiles(e.target.files); e.target.value = ""; } }),
      ),
    ),
    UploadPanel(),
    FilterBar(),
    ContactSheet(),
    Loupe(),
  );
}
