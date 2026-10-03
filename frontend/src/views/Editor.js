import van from "../../lib/van-1.6.1.js";
import { state } from "../state.js";
import { Pipeline, PipelineUnsupported } from "../pipeline/runner.js";
import { TOOLS, TOOL_ORDER } from "../pipeline/ops/index.js";
import { emptyRecipe, newEntry } from "../pipeline/recipe.js";
import { Slider } from "../components/Slider.js";
import { CurveEditor } from "../components/CurveEditor.js";
import { emptyNode } from "../vanHelpers.js";

const { div, canvas, button, span, h2, p, ol, li } = van.tags;

// The edit view: the photo's 2048 px preview rendered live through the pipeline, plus a Snapseed-
// style stack of tools. Rendering is the one piece of logic that runs in the browser
// (PROJECT_BRIEF.md §4). Saving the render and recipe comes in V1_PLAN.md Phase 11. Until then an
// edit lives only as long as this view is open.
//
// The recipe is a plain object mutated in place. Only structural changes (adding, removing, or
// selecting a stack entry) re-render the panel, so a slider is never re-created mid-drag.
// Whatever ends an editing session (Close, Esc, or navigating away, which clears state.editing)
// goes through this binding. So the previous session is always disposed: its GL context released
// and its key listeners removed.
let disposeSession = null;

export function Editor() {
  return () => {
    const photoState = state.editing.val;
    disposeSession?.();
    disposeSession = null;
    if (!photoState) return emptyNode();
    const session = EditorSession(photoState.rawVal);
    disposeSession = session.dispose;
    return session.element;
  };
}

function EditorSession(photo) {
  const recipe = emptyRecipe();
  const structure = van.state(0); // bumped when the stack changes shape
  const selected = van.state(-1);
  const compare = van.state(false);
  const status = van.state({ kind: "loading" }); // loading | ready | error
  const stage = canvas({ class: "editor-canvas" });

  let pipeline = null;
  let frame = 0;
  function scheduleRender() {
    if (!pipeline || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!pipeline) return;
      if (pipeline.lost) {
        status.val = { kind: "error", message: "The graphics context was lost. Close the editor and open it again." };
        return;
      }
      try {
        pipeline.renderToCanvas(recipe, { original: compare.val });
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
      img.src = photo.previewUrl;
      await img.decode();
      pipeline.setSource(img);
      status.val = { kind: "ready" };
      scheduleRender();
    } catch (e) {
      status.val = { kind: "error", message: e instanceof PipelineUnsupported ? e.message : "The photo couldn't be loaded into the editor." };
    }
  })();

  const changed = () => { structure.val++; scheduleRender(); };
  const add = (toolId) => { recipe.stack.push(newEntry(toolId)); selected.val = recipe.stack.length - 1; changed(); };
  const remove = (index) => {
    recipe.stack.splice(index, 1);
    selected.val = Math.min(selected.val, recipe.stack.length - 1);
    changed();
  };
  const dispose = () => {
    cancelAnimationFrame(frame);
    pipeline?.destroy();
    pipeline = null;
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("keyup", onKeyUp);
  };
  const close = () => {
    if (recipe.stack.length && !confirm("Close the editor? Your edits aren't saved yet and will be lost.")) return;
    state.editing.val = null; // the Editor binding disposes this session
  };
  const setCompare = (on) => { if (compare.val !== on) { compare.val = on; scheduleRender(); } };

  // \ shows the original while held (Lightroom's before/after key). Esc closes.
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "\\" && !e.repeat) { e.preventDefault(); setCompare(true); }
  }
  function onKeyUp(e) { if (e.key === "\\") setCompare(false); }
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKeyUp);

  const ToolPanel = () => () => {
    structure.val; // re-render when the stack changes shape
    const index = selected.val;
    const entry = recipe.stack[index];
    if (!entry) return p({ class: "editor-hint" }, recipe.stack.length ? "Select an edit to adjust it." : "Add a tool to start editing.");
    const tool = TOOLS[entry.tool];
    return div(
      { class: "tool-panel" },
      h2(tool.label),
      ...tool.params.map((spec) => (spec.kind === "curves" ? CurveEditor(entry.params[spec.id], scheduleRender) : Slider(spec, entry.params, scheduleRender))),
      p({ class: "editor-hint" }, "Double-click a slider to reset it."),
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
          button({ class: "stack-select", onclick: () => { selected.val = i; } }, `${i + 1}. ${TOOLS[entry.tool].label}`),
          button({ class: "stack-remove", "aria-label": `Remove ${TOOLS[entry.tool].label}`, title: "Remove this edit", onclick: () => remove(i) }, "×"),
        )),
    );
  };

  const element = div(
    { class: "editor", role: "dialog", "aria-label": `Editing ${photo.filename}` },
    div(
      { class: "editor-stage" },
      () => {
        const s = status.val;
        if (s.kind === "error") return p({ class: "editor-message" }, s.message);
        return span({ class: s.kind === "loading" ? "editor-loading" : "visually-hidden" }, "Loading…");
      },
      stage,
      () => (compare.val ? span({ class: "compare-badge" }, "Original") : emptyNode()),
    ),
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
        }, "Hold to compare"),
        span({ class: "editor-note" }, "Edits aren't saved yet.")),
    ),
  );
  return { element, dispose };
}
