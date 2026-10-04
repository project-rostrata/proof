import van from "../../lib/van-1.6.1.js";
import { state, showError } from "../state.js";
import { Pipeline, PipelineUnsupported } from "../pipeline/runner.js";
import { aspectRatio, centredRect } from "../pipeline/geometry.js";
import { emptyRecipe, newEntry, loadRecipe, RecipeError } from "../pipeline/recipe.js";
import { api, saveEdit, ApiError } from "../api.js";
import { CurveEditor } from "../components/CurveEditor.js";
import { CropOverlay } from "../components/CropOverlay.js";
import { emptyNode } from "../vanHelpers.js";
import { openTool } from "./editor/tool.js";
import { photoGestures } from "./editor/gestures.js";
import { DesktopPanel, PhoneControls } from "./editor/controls.js";
import { editPassPosition, leaveEditor, moveEditPass } from "../workflow.js";

const { div, canvas, span, p } = van.tags;

// The edit view: a 2048 px preview of the *original* rendered live through the pipeline, plus a
// Snapseed-style stack of edits. Rendering is the one piece of logic that runs in the browser
// (PROJECT_BRIEF.md §4).
//
// As in Snapseed, you open a tool, adjust it, and apply (✓, Done, Enter) or discard (✕, Cancel,
// Esc) it, and each use of a tool is one layer in the stack. With a tool open, the photo is the
// control (editor/gestures.js). On phones the photo fills the screen and everything else is a bar
// and sheets. On larger screens there's a panel beside it (editor/controls.js).
//
// Saving renders the original at full resolution through the same recipe, JPEG-encodes it, and
// uploads it with the recipe. The server stores both and makes thumbnails from the render.
// Reopening loads the saved recipe, so edits stay non-destructive.
//
// In the edit pass (workflow.js) the editor steps through the picks: Next saves, if anything
// changed, and opens the next pick (a new session); Finish, on the last, goes on to Export.
//
// The recipe is a plain object mutated in place. Only structural changes (adding, removing,
// opening, or closing a tool) re-render the controls, so nothing is re-created mid-drag.

// Phones get the full-screen layout. A live query: turning a tablet re-lays the editor out.
const PHONE = "(max-width: 800px)";

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

function EditorSession(photoState) {
  const photo = photoState.rawVal;
  const recipe = emptyRecipe();
  const dirty = van.state(false); //       unsaved changes since opening or the last save
  const saving = van.state(null); //       null, or a progress message while saving
  const hasSavedEdit = van.state(photo.hasEdit);
  let base = photo.editVersion; //         the saved edit this session started from (sent on save)
  let previewImage = null;
  const structure = van.state(0); // bumped when the stack changes shape, or a tool opens or closes
  const current = van.state(null); // the open tool (editor/tool.js), or null
  const compare = van.state(false);
  const status = van.state({ kind: "loading" }); // loading | ready | error
  const phoneQuery = matchMedia(PHONE);
  const phone = van.state(phoneQuery.matches);
  const sheet = van.state(null); // on phones, the sheet that's up: "tools", "edits", "controls", or null
  const stage = canvas({ class: "editor-canvas" });
  const overlayHost = div({ class: "editor-overlay" });
  const frameEl = div({ class: "editor-frame" }, stage, overlayHost);
  const stageEl = div({ class: "editor-stage" });

  // What the stage shows: the whole stack, except while Crop & Rotate is open. Then it's the stack
  // up to and including it, with its crop left out, so the crop box is drawn over the whole
  // straightened photo (you're choosing what to keep).
  function renderArgs() {
    if (compare.val) return [recipe, { original: true }];
    const t = current.val;
    if (t?.tool.geometry === "crop") {
      const index = recipe.stack.indexOf(t.entry);
      const stack = recipe.stack.slice(0, index + 1);
      stack[index] = { ...t.entry, params: { ...t.entry.params, rect: [0, 0, 1, 1] } };
      return [{ ...recipe, stack }, {}];
    }
    return [recipe, {}];
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
        pipeline.renderToCanvas(...renderArgs());
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

  // ---- the stack and the open tool ----

  // `wasDirty` is what ✕ puts back: discarding a tool's changes leaves the session as it was.
  const open = (entry, isNew, wasDirty = dirty.val) => {
    const t = openTool(entry, isNew);
    t.wasDirty = wasDirty;
    current.val = t;
    sheet.val = null;
    changed();
  };
  const add = (toolId) => {
    apply(); // a tool that's open is kept as it is
    const wasDirty = dirty.val;
    const entry = newEntry(toolId);
    recipe.stack.push(entry);
    dirty.val = true;
    open(entry, true, wasDirty);
  };
  const apply = () => {
    if (!current.val) return;
    current.val = null;
    changed();
  };
  // A new layer is dropped. An existing one gets back the parameters it had when it was opened.
  const cancel = () => {
    const t = current.val;
    if (!t) return;
    if (t.isNew) recipe.stack.splice(recipe.stack.indexOf(t.entry), 1);
    else t.entry.params = structuredClone(t.before);
    dirty.val = t.wasDirty;
    current.val = null;
    changed();
  };
  const remove = (index) => {
    const [removed] = recipe.stack.splice(index, 1);
    if (current.val?.entry === removed) current.val = null;
    dirty.val = true;
    changed();
  };

  // ---- Crop & Rotate's buttons (they need the stage's size) ----

  let cropOverlay = null;
  // While Crop & Rotate is open the stage shows its uncropped result, which is what the crop box is
  // normalised to.
  const inputSize = () => [stage.width, stage.height];
  const geometryParams = () => current.val.entry.params;
  const setAspect = (a) => {
    const params = geometryParams();
    params.aspect = a;
    const ratio = aspectRatio(a, ...inputSize());
    if (ratio !== null) {
      params.rect = centredRect(ratio, ...inputSize());
      cropOverlay?.reset(params.rect);
    }
    dirty.val = true;
  };
  const resetCrop = () => {
    const params = geometryParams();
    params.aspect = "free";
    params.rect = [0, 0, 1, 1];
    cropOverlay?.reset(params.rect);
    dirty.val = true;
  };
  // A quarter turn swaps the photo's sides, so a fixed aspect is re-fitted to the turned photo.
  const turn = (delta) => {
    const params = geometryParams();
    params.quarterTurns = (params.quarterTurns + delta + 4) % 4;
    if (params.aspect !== "free") {
      const [w, h] = inputSize();
      params.rect = centredRect(aspectRatio(params.aspect, h, w), h, w);
      cropOverlay?.reset(params.rect);
    }
    edited();
  };
  const flip = () => {
    const params = geometryParams();
    params.flip = !params.flip;
    edited();
  };

  // ---- saving ----

  // Save: the original at full resolution, through exactly the preview's recipe, JPEG-encoded and
  // uploaded with the recipe. The preview source is restored afterwards. An open tool is applied
  // first, so what's saved is what's shown.
  async function save() {
    if (!pipeline || saving.val) return;
    apply();
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
      current.val = null;
      dirty.val = false;
      changed();
    } catch (e) {
      showError(e instanceof ApiError ? e.message : "Reverting failed.");
    }
  }

  const close = () => {
    if (saving.val) return;
    if (dirty.val && !confirm("Close the editor? Your unsaved changes will be lost.")) return;
    leaveEditor(); // clears state.editing, so the Editor binding disposes this session
  };

  // ---- the edit pass ----

  // Moving on applies an open tool and saves, if anything changed. A failed save (shown as an
  // error) stays on this photo, so nothing is lost.
  async function moveOn(target) {
    if (saving.val) return;
    apply();
    if (dirty.val) {
      await save();
      if (dirty.val) return;
    }
    if (target) moveEditPass(target); // a new session for that photo
    else leaveEditor({ finished: true });
  }
  const position = state.editPass.val ? editPassPosition(photoState) : null;
  const pass = position && {
    position: `${position.index + 1} / ${position.count}`,
    back: position.previous ? () => moveOn(position.previous) : null,
    next: () => moveOn(position.next),
    nextLabel: position.next ? "Next ›" : "Finish ›",
  };
  const setCompare = (on) => { if (compare.val !== on) { compare.val = on; changed(); } };

  // ---- keys and layout changes ----

  // \ shows the original while held (Lightroom's before/after key). Enter applies the open tool and
  // Esc discards it. With no tool open, Esc closes a sheet, then the editor.
  function onKey(e) {
    if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (current.val) cancel();
      else if (sheet.val) sheet.val = null;
      else close();
    } else if (e.key === "Enter" && current.val) { e.preventDefault(); apply(); }
    else if (e.key === "\\" && !e.repeat) { e.preventDefault(); setCompare(true); }
  }
  function onKeyUp(e) { if (e.key === "\\") setCompare(false); }
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKeyUp);
  const onLayoutChange = () => { phone.val = phoneQuery.matches; sheet.val = null; changed(); };
  phoneQuery.addEventListener("change", onLayoutChange);

  const dispose = () => {
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    pipeline?.destroy();
    pipeline = null;
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("keyup", onKeyUp);
    phoneQuery.removeEventListener("change", onLayoutChange);
  };

  // ---- the photo: gestures and overlays ----

  const gestures = photoGestures(stageEl, { tool: () => (compare.val ? null : current.val), onChange: edited });

  van.add(overlayHost, () => {
    structure.val;
    cropOverlay = null;
    const t = current.val;
    if (!t || compare.val) return emptyNode();
    if (t.tool.geometry === "crop") {
      // The crop box is always shown. It takes drags only while it's the active pick, and the
      // alignment grid shows while straightening or correcting perspective.
      const params = t.entry.params;
      cropOverlay = CropOverlay(params, () => aspectRatio(params.aspect, ...inputSize()), inputSize, () => { dirty.val = true; });
      return div({ class: () => `geometry-overlay${t.cropActive() ? " is-cropping" : ""}` }, div({ class: "grid-overlay" }), cropOverlay.element);
    }
    // On phones the curve is drawn over the photo, as in Snapseed. On larger screens it's in the panel.
    if (phone.val && t.tool.params.some((s) => s.kind === "curves")) return CurveEditor(t.entry.params.points, edited, { overlay: true });
    return emptyNode();
  });

  van.add(stageEl,
    () => {
      const s = status.val;
      if (s.kind === "error") return p({ class: "editor-message" }, s.message);
      return span({ class: s.kind === "loading" ? "editor-loading" : "visually-hidden" }, "Loading…");
    },
    frameEl,
    gestures.Readout(),
    () => (compare.val ? span({ class: "compare-badge" }, "Original") : emptyNode()),
    pass ? span({ class: "pass-badge" }, pass.position) : "");

  // ---- the controls ----

  const ui = {
    filename: photo.filename, recipe, structure, current, sheet, dirty, saving, hasSavedEdit,
    add, open, apply, cancel, remove, edited, save, revert, close, setCompare, pass,
    setAspect, resetCrop, turn, flip,
    canSave: () => dirty.val && !saving.val && status.val.kind === "ready",
  };

  const element = div(
    { class: "editor", role: "dialog", "aria-label": `Editing ${photo.filename}` },
    stageEl,
    () => (phone.val ? PhoneControls(ui) : DesktopPanel(ui)),
  );
  return { element, dispose };
}
