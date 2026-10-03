import van from "../../lib/van-1.6.1.js";
import { state } from "../state.js";
import { navigate } from "../router.js";
import { uploadFiles } from "../upload.js";
import { emptyNode } from "../vanHelpers.js";

const { main, section, div, h1, span, button, input, label, img, figure, figcaption, progress, p } = van.tags;

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
            u.status === "failed"
              ? span({ class: "upload-error" }, u.error)
              : progress({ max: u.total || 1, value: u.loaded }),
          )),
      ),
    );
  };
}

function PhotoGrid(photos) {
  if (!photos.length) {
    return p({ class: "empty-state" }, "No photos yet. Drop JPEG or PNG files anywhere on this page, or use Add photos.");
  }
  return div(
    { class: "contact-sheet" },
    ...photos.map((photo) =>
      figure(
        { class: "frame", title: [photo.filename, photo.captureDisplay, photo.cameraDisplay, photo.exposureDisplay].filter(Boolean).join("\n") },
        div({ class: "frame-image" }, img({ src: photo.thumbUrl, alt: photo.filename, loading: "lazy", decoding: "async" })),
        figcaption(photo.filename),
      )),
  );
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
    () => {
      const current = state.current.val;
      if (!current) return div({ class: "empty-state" }, "Loading…");
      return div(
        section(
          { class: "page-header" },
          button({ class: "btn-ghost btn-small", onclick: () => navigate(null) }, "← Projects"),
          div({ class: "page-title" }, h1(current.project.name), span({ class: "page-subtitle" }, current.project.photoCountDisplay)),
          label(
            { class: "btn-primary" },
            "Add photos",
            input({ type: "file", multiple: true, accept: "image/jpeg,image/png", class: "visually-hidden", onchange: (e) => { onFiles(e.target.files); e.target.value = ""; } }),
          ),
        ),
        UploadPanel(),
        PhotoGrid(current.photos),
      );
    },
  );
}
