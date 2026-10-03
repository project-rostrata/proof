import van from "../../lib/van-1.6.1.js";
import { state, showError } from "../state.js";
import { Pipeline, PipelineUnsupported } from "../pipeline/runner.js";
import { TOOLS, TOOL_ORDER } from "../pipeline/ops/index.js";
import { ASPECT_OPTIONS } from "../pipeline/ops/crop.js";
import { aspectRatio, centredRect } from "../pipeline/geometry.js";
import { emptyRecipe, newEntry, loadRecipe, RecipeError } from "../pipeline/recipe.js";
import { api, saveEdit, ApiError } from "../api.js";
import { Slider } from "../components/Slider.js";
import { CurveEditor } from "../components/CurveEditor.js";
import { Choice } from "../components/Choice.js";
import { CropOverlay } from "../components/CropOverlay.js";
import { GridOverlay } from "../components/GridOverlay.js";
import { emptyNode } from "../vanHelpers.js";

const { div, canvas, button, span, h2, p, ol, li } = van.tags;

// The edit view: a 2048 px preview of the *original* rendered live through the pipeline, plus a
// Snapseed-style stack of tools. Rendering is the one piece of logic that runs in the browser
// (PROJECT_BRIEF.md §4).
//
// Saving renders the original at full resolution through the same recipe, JPEG-encodes it, and
// uploads it with the recipe. The server stores both and makes thumbnails from the render.
// Reopening loads the saved recipe, so edits stay non-destructive.
//
// The recipe is a plain object mutated in place. Only structural changes (adding, removing, or
// selecting a stack entry) re-render the panel, so a slider is never re-created mid-drag.
//
// What the stage shows depends on the selected entry:
//   - a crop: the stack *before* it, with a crop box on top (you're choosing what to keep);
//   - Rotate or Perspective: the stack up to and including it, with an alignment grid;
//   - anything else, or nothing selected: the whole stack.

// Whatever ends an editing session (Close, Esc, or navigating away, which clears state.editing)
// goes through this binding. So the previous session is always disposed: its GL context released
// and its listeners removed.
let disposeSession = null;

export function Editor() {
  return () => {
    const photoState = state.editing.val;
    disposeSession?.();
    disposeSession = null;
    if (!photoState) return emptyNode();
    const session = EditorSession(photoState);
    disposeSession = session.dispose;
    return session.element;
  };
}

const ASPECT_LABELS = { free: "Free", original: "Original" };

function EditorSession(photoState) {
  const photo = photoState.rawVal;
  const recipe = emptyRecipe();
  const dirty = van.state(false); //       unsaved changes since opening or the last save
  const saving = van.state(null); //       null, or a progress message while saving
  const hasSavedEdit = van.state(photo.hasEdit);
  let base = photo.editVersion; //         the saved edit this session started from (sent on save)
  let previewImage = null;
  const structure = van.state(0); // bumped when the stack changes shape or the selection changes
  const selected = van.state(-1);
  const compare = van.state(false);
  const status = van.state({ kind: "loading" }); // loading | ready | error
  const stage = canvas({ class: "editor-canvas" });
  const overlayHost = div({ class: "editor-overlay" });
  const frameEl = div({ class: "editor-frame" }, stage, overlayHost);
  const stageEl = div({ class: "editor-stage" });

  const selectedEntry = () => recipe.stack[selected.val];
  const selectedTool = () => (selectedEntry() ? TOOLS[selectedEntry().tool] : null);

  function renderOptions() {
    if (compare.val) return { original: true };
    const geometry = selectedTool()?.geometry;
    if (geometry === "input") return { upTo: selected.val };
    if (geometry === "grid") return { upTo: selected.val + 1 };
    return {};
  }

  // Fit the canvas (whose pixel size is the rendered image's) into the stage, and size the overlay
  // frame to match, so the overlays' percentages line up with the photo.
  function layout() {
    if (!stage.width || !stage.height) return;
    const style = getComputedStyle(stageEl);
    const availW = stageEl.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const availH = stageEl.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const scale = Math.min(availW / stage.width, availH / stage.height);
    frameEl.style.width = `${Math.max(1, Math.floor(stage.width * scale))}px`;
    frameEl.style.height = `${Math.max(1, Math.floor(stage.height * scale))}px`;
  }
  const resizeObserver = new ResizeObserver(layout);
  resizeObserver.observe(stageEl);

  let pipeline = null;
  let frame = 0;
  function scheduleRender() {
    if (!pipeline || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!pipeline?.source) return; // still loading, or already closed
      if (pipeline.lost) {
        status.val = { kind: "error", message: "The graphics context was lost. Close the editor and open it again." };
        return;
      }
      try {
        pipeline.renderToCanvas(recipe, renderOptions());
        layout();
      } catch (e) {
        console.error(e);
        status.val = { kind: "error", message: "Rendering failed. Close the editor and open it again." };
      }
    });
  }

  (async () => {
    try {
      pipeline = new Pipeline(stage);
      const img = new Image();
      img.src = photo.sourcePreviewUrl; // always the original: edits are re-applied, never stacked on a render
      if (photo.hasEdit) {
        const saved = await api.getEdit(photo.id);
        recipe.stack = loadRecipe(saved.recipe).stack;
        base = saved.editVersion;
      }
      await img.decode();
      previewImage = img;
      pipeline.setSource(img);
      status.val = { kind: "ready" };
      changed();
    } catch (e) {
      const message = e instanceof PipelineUnsupported || e instanceof RecipeError || e instanceof ApiError
        ? e.message : "The photo couldn't be loaded into the editor.";
      status.val = { kind: "error", message };
    }
  })();

  const changed = () => { structure.val++; scheduleRender(); };
  // Every change to the recipe goes through edited(): it re-renders and marks the session unsaved.
  const edited = () => { dirty.val = true; scheduleRender(); };
  const select = (index) => { selected.val = index; changed(); };
  const add = (toolId) => { recipe.stack.push(newEntry(toolId)); dirty.val = true; select(recipe.stack.length - 1); };
  const remove = (index) => {
    recipe.stack.splice(index, 1);
    selected.val = Math.min(selected.val, recipe.stack.length - 1);
    dirty.val = true;
    changed();
  };

  // Save: the original at full resolution, through exactly the preview's recipe, JPEG-encoded and
  // uploaded with the recipe. The preview source is restored afterwards.
  async function save() {
    if (!pipeline || saving.val) return;
    saving.val = "Rendering at full resolution…";
    let restored = false;
    try {
      const original = await (await fetch(photo.originalUrl, { credentials: "same-origin" })).blob();
      const bitmap = await createImageBitmap(original, { imageOrientation: "from-image" });
      pipeline.setSource(bitmap);
      const { width, height, pixels } = pipeline.renderToPixels(recipe);
      bitmap.close();
      pipeline.setSource(previewImage);
      restored = true;
      scheduleRender();
      saving.val = "Encoding…";
      const canvasEl = document.createElement("canvas");
      canvasEl.width = width;
      canvasEl.height = height;
      canvasEl.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), width, height), 0, 0);
      const jpeg = await new Promise((resolve, reject) => canvasEl.toBlob((b) => (b ? resolve(b) : reject(new Error("JPEG encoding failed"))), "image/jpeg", 0.92));
      canvasEl.width = canvasEl.height = 0;
      const updated = await saveEdit(photo.id, base, recipe, jpeg, (loaded, total) => {
        saving.val = `Uploading… ${Math.round((100 * loaded) / total)} %`;
      });
      photoState.val = updated;
      base = updated.editVersion;
      hasSavedEdit.val = true;
      dirty.val = false;
    } catch (e) {
      showError(e instanceof ApiError || e instanceof PipelineUnsupported ? e.message : "Saving failed.");
      console.error(e);
    } finally {
      if (!restored && previewImage && pipeline) { pipeline.setSource(previewImage); scheduleRender(); }
      saving.val = null;
    }
  }

  // Revert: delete the saved edit and go back to the original.
  async function revert() {
    if (!confirm("Revert to the original? The saved edit is deleted.")) return;
    try {
      const updated = await api.revertEdit(photo.id);
      photoState.val = updated;
      base = updated.editVersion;
      hasSavedEdit.val = false;
      recipe.stack = [];
      selected.val = -1;
      dirty.val = false;
      changed();
    } catch (e) {
      showError(e instanceof ApiError ? e.message : "Reverting failed.");
    }
  }
  const dispose = () => {
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    pipeline?.destroy();
    pipeline = null;
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("keyup", onKeyUp);
  };
  const close = () => {
    if (saving.val) return;
    if (dirty.val && !confirm("Close the editor? Your unsaved changes will be lost.")) return;
    state.editing.val = null; // the Editor binding disposes this session
  };
  const setCompare = (on) => { if (compare.val !== on) { compare.val = on; changed(); } };

  // \ shows the original while held (Lightroom's before/after key). Enter finishes the selected
  // tool. Esc closes.
  function onKey(e) {
    if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Enter" && selected.val >= 0) { e.preventDefault(); select(-1); }
    else if (e.key === "\\" && !e.repeat) { e.preventDefault(); setCompare(true); }
  }
  function onKeyUp(e) { if (e.key === "\\") setCompare(false); }
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKeyUp);

  // ---- overlays ----

  let cropOverlay = null;
  const inputSize = () => [stage.width, stage.height]; // the crop step's input while a crop is selected
  van.add(overlayHost, () => {
    structure.val;
    cropOverlay = null;
    const tool = selectedTool();
    if (!tool || compare.val) return emptyNode();
    if (tool.geometry === "input") {
      const entry = selectedEntry();
      cropOverlay = CropOverlay(entry.params, () => aspectRatio(entry.params.aspect, ...inputSize()), inputSize, () => { dirty.val = true; });
      return cropOverlay.element;
    }
    if (tool.geometry === "grid") return GridOverlay();
    return emptyNode();
  });

  // ---- tool panels ----

  function CropControls(entry) {
    const aspect = van.state(entry.params.aspect);
    const choose = (a) => {
      dirty.val = true;
      entry.params.aspect = a;
      aspect.val = a;
      const ratio = aspectRatio(a, ...inputSize());
      if (ratio !== null) {
        entry.params.rect = centredRect(ratio, ...inputSize());
        cropOverlay?.reset(entry.params.rect);
      }
    };
    return [
      span({ class: "editor-label" }, "Aspect ratio"),
      div({ class: "choice-buttons" }, ...ASPECT_OPTIONS.map((a) => button({
        class: () => `btn-ghost btn-small${aspect.val === a ? " is-active" : ""}`, onclick: () => choose(a),
      }, ASPECT_LABELS[a] ?? a))),
      p({ class: "editor-hint" }, "Drag the corners or edges to crop, or drag inside the box to move it. Enter or Done applies it."),
      button({ class: "btn-ghost btn-small", onclick: () => { dirty.val = true; entry.params.aspect = "free"; aspect.val = "free"; entry.params.rect = [0, 0, 1, 1]; cropOverlay?.reset(entry.params.rect); } }, "Reset crop"),
    ];
  }

  function RotateControls(entry, tool) {
    const flipped = van.state(entry.params.flip);
    const turn = (delta) => { entry.params.quarterTurns = (entry.params.quarterTurns + delta + 4) % 4; edited(); };
    return [
      div({ class: "choice-buttons" },
        button({ class: "btn-ghost btn-small", onclick: () => turn(3), title: "Rotate 90° counter-clockwise" }, "↺ 90°"),
        button({ class: "btn-ghost btn-small", onclick: () => turn(1), title: "Rotate 90° clockwise" }, "↻ 90°"),
        button({
          class: () => `btn-ghost btn-small${flipped.val ? " is-active" : ""}`, title: "Flip horizontally",
          onclick: () => { entry.params.flip = !entry.params.flip; flipped.val = entry.params.flip; edited(); },
        }, "Flip")),
      Slider(tool.params.find((s) => s.id === "angle"), entry.params, edited),
      p({ class: "editor-hint" }, "Straightening crops to the largest rectangle that fits, so there are no blank corners."),
    ];
  }

  const ToolPanel = () => () => {
    structure.val; // re-render when the stack or selection changes
    const entry = selectedEntry();
    if (!entry) return p({ class: "editor-hint" }, recipe.stack.length ? "Select an edit to adjust it." : "Add a tool to start editing.");
    const tool = TOOLS[entry.tool];
    let controls;
    if (tool.id === "crop") controls = CropControls(entry);
    else if (tool.id === "rotate") controls = RotateControls(entry, tool);
    else {
      controls = tool.params.map((spec) => {
        if (spec.kind === "curves") return CurveEditor(entry.params[spec.id], edited);
        if (spec.kind === "choice") return Choice(spec, entry.params, edited);
        return Slider(spec, entry.params, edited);
      });
      controls.push(p({ class: "editor-hint" }, "Double-click a slider to reset it."));
    }
    return div(
      { class: "tool-panel" },
      div({ class: "tool-panel-head" }, h2(tool.label), button({ class: "btn-primary btn-small", onclick: () => select(-1) }, "Done")),
      ...controls,
    );
  };

  const Stack = () => () => {
    structure.val;
    const current = selected.val;
    if (!recipe.stack.length) return emptyNode();
    return ol(
      { class: "edit-stack" },
      ...recipe.stack.map((entry, i) =>
        li(
          { class: i === current ? "stack-entry is-active" : "stack-entry" },
          button({ class: "stack-select", onclick: () => select(i) }, `${i + 1}. ${TOOLS[entry.tool].label}`),
          button({ class: "stack-remove", "aria-label": `Remove ${TOOLS[entry.tool].label}`, title: "Remove this edit", onclick: () => remove(i) }, "×"),
        )),
    );
  };

  van.add(stageEl,
    () => {
      const s = status.val;
      if (s.kind === "error") return p({ class: "editor-message" }, s.message);
      return span({ class: s.kind === "loading" ? "editor-loading" : "visually-hidden" }, "Loading…");
    },
    frameEl,
    () => (compare.val ? span({ class: "compare-badge" }, "Original") : emptyNode()));

  const element = div(
    { class: "editor", role: "dialog", "aria-label": `Editing ${photo.filename}` },
    stageEl,
    div(
      { class: "editor-panel" },
      div({ class: "editor-header" },
        span({ class: "editor-title" }, photo.filename),
        button({ class: "btn-ghost btn-small", onclick: close }, "Close")),
      div({ class: "editor-section" },
        span({ class: "editor-label" }, "Add a tool"),
        div({ class: "tool-buttons" }, ...TOOL_ORDER.map((id) => button({ class: "btn-ghost btn-small", onclick: () => add(id) }, TOOLS[id].label)))),
      div({ class: "editor-section" }, span({ class: "editor-label" }, "Edits"), Stack()),
      div({ class: "editor-section editor-tool" }, ToolPanel()),
      div({ class: "editor-footer" },
        button({
          class: "btn-ghost btn-small",
          onpointerdown: () => setCompare(true), onpointerup: () => setCompare(false), onpointerleave: () => setCompare(false),
          title: "Hold to see the original (or hold \\)",
        }, "Compare"),
        () => (hasSavedEdit.val ? button({ class: "btn-ghost btn-small btn-danger", disabled: () => !!saving.val, onclick: revert }, "Revert") : emptyNode()),
        span({ class: "editor-note" }, () => saving.val ?? (dirty.val ? "Unsaved changes" : hasSavedEdit.val ? "Saved" : "")),
        button({ class: "btn-primary btn-small editor-save", disabled: () => !dirty.val || !!saving.val || status.val.kind !== "ready", onclick: save }, "Save")),
    ),
  );
  return { element, dispose };
}
