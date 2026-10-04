import van from "../../../lib/van-1.6.1.js";
import { TOOLS, TOOL_GROUPS } from "../../pipeline/ops/index.js";
import { ASPECT_OPTIONS } from "../../pipeline/ops/crop-rotate.js";
import { Slider, formatValue } from "../../components/Slider.js";
import { CurveEditor } from "../../components/CurveEditor.js";
import { Choice } from "../../components/Choice.js";
import { emptyNode } from "../../vanHelpers.js";

const { div, button, span, h2, p, ol, li } = van.tags;

// The editor's controls, in two layouts built from the same pieces (Editor.js picks one):
//   - DesktopPanel: a panel beside the photo, with the tools, the edit stack, and the open tool's
//     sliders.
//   - PhoneControls: Snapseed's layout. The photo fills the screen, with one bar of buttons under
//     it, and everything else in sheets that slide up over the photo. The open tool has no sliders
//     on screen: the photo gestures (gestures.js) are the control, and ≡ lists the choices.
// `ui` is the editor session's state and actions (Editor.js).

const ASPECT_LABELS = { free: "Free", original: "Original" };

// ---- pieces shared by both layouts ----

function ToolGroups(ui) {
  return TOOL_GROUPS.map((group) => div({ class: "tool-group" },
    span({ class: "editor-label" }, group.label),
    div({ class: "tool-buttons" }, ...group.tools.map((id) => button({ class: "btn-ghost btn-small", onclick: () => ui.add(id) }, TOOLS[id].label)))));
}

// The edit stack: one layer per use of a tool. Selecting one opens it.
const Stack = (ui) => () => {
  ui.structure.val;
  const open = ui.current.val?.entry;
  if (!ui.recipe.stack.length) return p({ class: "editor-hint" }, "No edits yet.");
  return ol({ class: "edit-stack" }, ...ui.recipe.stack.map((entry, i) =>
    li({ class: entry === open ? "stack-entry is-active" : "stack-entry" },
      button({ class: "stack-select", onclick: () => ui.open(entry, false) }, `${i + 1}. ${TOOLS[entry.tool].label}`),
      button({ class: "stack-remove", "aria-label": `Remove ${TOOLS[entry.tool].label}`, title: "Remove this edit", onclick: () => ui.remove(i) }, "×"))));
};

// Crop & Rotate's aspect presets and reset (its `rect` and `aspect` params).
function AspectControls(ui, t) {
  const aspect = van.state(t.entry.params.aspect);
  return [
    div({ class: "choice-buttons" }, ...ASPECT_OPTIONS.map((a) => button({
      class: () => `btn-ghost btn-small${aspect.val === a ? " is-active" : ""}`,
      onclick: () => { ui.setAspect(a); aspect.val = a; },
    }, ASPECT_LABELS[a] ?? a))),
    button({ class: "btn-ghost btn-small", onclick: () => { ui.resetCrop(); aspect.val = "free"; } }, "Reset crop"),
  ];
}

// Crop & Rotate's quarter turns and flip (its `quarterTurns` and `flip` params).
function TurnControls(ui, t) {
  const flipped = van.state(t.entry.params.flip);
  return div({ class: "choice-buttons" },
    button({ class: "btn-ghost btn-small", onclick: () => ui.turn(3), title: "Rotate 90° counter-clockwise" }, "↺ 90°"),
    button({ class: "btn-ghost btn-small", onclick: () => ui.turn(1), title: "Rotate 90° clockwise" }, "↻ 90°"),
    button({
      class: () => `btn-ghost btn-small${flipped.val ? " is-active" : ""}`, title: "Flip horizontally",
      onclick: () => { ui.flip(); flipped.val = t.entry.params.flip; },
    }, "Flip"));
}

// The open tool's controls other than its sliders, in parameter order. Crop & Rotate's `aspect` is
// shown with its crop box (`rect`), and its `flip` with its turns, so those two are skipped here.
function OtherControls(ui, t, { cropSection }) {
  const params = t.entry.params;
  return t.tool.params.flatMap((spec) => {
    if (spec.kind === "rect") return [cropSection()];
    if (spec.kind === "turns") return [TurnControls(ui, t)];
    if (spec.kind === "choice" && spec.id !== "aspect") return [Choice(spec, params, ui.edited)];
    return [];
  });
}

const GESTURE_HINT = "Drag sideways on the photo, or scroll, to change the highlighted control. Drag up or down on the photo to pick another.";

// ---- desktop: a panel beside the photo ----

export function DesktopPanel(ui) {
  const ToolPanel = () => () => {
    ui.structure.val;
    const t = ui.current.val;
    if (!t) return p({ class: "editor-hint" }, ui.recipe.stack.length ? "Select an edit to adjust it, or add a tool." : "Add a tool to start editing.");
    const params = t.entry.params;
    // Crop & Rotate's crop box is one of its picks: pressing this section makes it the active one.
    const cropSection = () => div(
      { class: () => `pick-section${t.cropActive() ? " is-active" : ""}`, onpointerdown: () => { t.active.val = "rect"; } },
      span({ class: "editor-label" }, "Crop"),
      ...AspectControls(ui, t),
      p({ class: "editor-hint" }, "Drag the corners or edges of the box. Straightening crops to the largest rectangle that fits."));
    const controls = t.tool.params.flatMap((spec) => {
      if (spec.kind === "curves") return [CurveEditor(params[spec.id], ui.edited)];
      if (!spec.kind) return [Slider(spec, params, ui.edited, { shown: t.shown.get(spec.id), active: t.active })];
      return [];
    });
    return div({ class: "tool-panel" },
      div({ class: "tool-panel-head" }, h2(t.tool.label),
        div({ class: "tool-panel-actions" },
          button({ class: "btn-ghost btn-small", onclick: ui.cancel, title: "Discard this tool's changes (Esc)" }, "Cancel"),
          button({ class: "btn-primary btn-small", onclick: ui.apply, title: "Apply (Enter)" }, "Done"))),
      ...OtherControls(ui, t, { cropSection }),
      ...controls,
      t.picks.some((pick) => pick.spec) ? p({ class: "editor-hint" }, `${GESTURE_HINT} Double-click a slider to reset it.`) : "");
  };

  return div({ class: "editor-panel" },
    div({ class: "editor-header" },
      span({ class: "editor-title" }, ui.filename),
      button({ class: "btn-ghost btn-small", onclick: ui.close }, "Close")),
    div({ class: "editor-section" }, ...ToolGroups(ui)),
    div({ class: "editor-section" }, span({ class: "editor-label" }, "Edits"), Stack(ui)),
    div({ class: "editor-section editor-tool" }, ToolPanel()),
    div({ class: "editor-footer" },
      CompareButton(ui, "btn-ghost btn-small"),
      () => (ui.hasSavedEdit.val ? button({ class: "btn-ghost btn-small btn-danger", disabled: () => !!ui.saving.val, onclick: ui.revert }, "Revert") : emptyNode()),
      span({ class: "editor-note" }, () => ui.saving.val ?? (ui.dirty.val ? "Unsaved changes" : ui.hasSavedEdit.val ? "Saved" : "")),
      button({ class: "btn-primary btn-small editor-save", disabled: () => !ui.canSave(), onclick: ui.save }, "Save")));
}

// Shows the original while held (pointer), as Snapseed's compare does.
function CompareButton(ui, className) {
  return button({
    class: className,
    onpointerdown: () => ui.setCompare(true), onpointerup: () => ui.setCompare(false),
    onpointerleave: () => ui.setCompare(false), onpointercancel: () => ui.setCompare(false),
    oncontextmenu: (e) => e.preventDefault(), // a long press on a phone would open the menu
    title: "Hold to see the original (or hold \\)",
  }, "Compare");
}

// ---- phones: Snapseed's layout ----

export function PhoneControls(ui) {
  const toggle = (name) => { ui.sheet.val = ui.sheet.val === name ? null : name; };

  // ≡ for the open tool: every pick with its value (tap one to make it active), then the tool's
  // other controls. There are no sliders: the photo is the slider.
  const ControlsList = (t) => {
    const params = t.entry.params;
    const rows = t.picks.map((pick) => button({
      class: () => `pick-row${t.active.val === pick.id ? " is-active" : ""}`,
      onclick: () => { t.active.val = pick.id; ui.sheet.val = null; },
    }, span(pick.label), pick.spec ? span({ class: "adjust-value" }, () => formatValue(pick.spec, t.shown.get(pick.id).val)) : span({ class: "pick-note" }, "drag the box")));
    const cropSection = () => div({ class: "sheet-section" }, ...AspectControls(ui, t));
    const curvesHint = t.tool.params.some((s) => s.kind === "curves") ? [p({ class: "editor-hint" }, "Drag the curve on the photo: tap to add a point, drag to move it.")] : [];
    return [
      ...rows,
      ...OtherControls(ui, t, { cropSection }),
      ...curvesHint,
      t.picks.some((pick) => pick.spec) ? p({ class: "editor-hint" }, "On the photo: swipe up or down to choose, left or right to change.") : "",
    ];
  };

  const Sheet = () => () => {
    ui.structure.val;
    const name = ui.sheet.val;
    const t = ui.current.val;
    if (!name || (name === "controls" && !t)) return emptyNode();
    const [title, content] =
      name === "tools" ? ["Tools", ToolGroups(ui)]
      : name === "edits" ? ["Edits", [Stack(ui), ui.hasSavedEdit.val ? button({ class: "btn-ghost btn-small btn-danger sheet-revert", onclick: () => { ui.sheet.val = null; ui.revert(); } }, "Revert to original") : ""]]
      : [t.tool.label, ControlsList(t)];
    return div({ class: "sheet-layer" },
      div({ class: "sheet-scrim", onclick: () => { ui.sheet.val = null; } }),
      div({ class: "editor-sheet", role: "dialog", "aria-label": title },
        div({ class: "sheet-head" }, span({ class: "sheet-title" }, title), button({ class: "btn-ghost btn-small", onclick: () => { ui.sheet.val = null; } }, "Close")),
        ...content));
  };

  const Bar = () => () => {
    ui.structure.val;
    const t = ui.current.val;
    if (t) {
      return div({ class: "editor-bar" },
        button({ class: "bar-button bar-icon", "aria-label": "Discard this tool's changes", onclick: ui.cancel }, "✕"),
        button({ class: "bar-button bar-title", onclick: () => toggle("controls") }, t.tool.label),
        button({ class: "bar-button bar-icon", "aria-label": "Controls", onclick: () => toggle("controls") }, "≡"),
        button({ class: "bar-button bar-icon is-primary", "aria-label": "Apply", onclick: ui.apply }, "✓"));
    }
    return div({ class: "editor-bar" },
      button({ class: "bar-button bar-icon", "aria-label": "Close the editor", onclick: ui.close }, "✕"),
      button({ class: "bar-button", onclick: () => toggle("tools") }, "Tools"),
      button({ class: "bar-button", onclick: () => toggle("edits") }, ui.recipe.stack.length ? `Edits ${ui.recipe.stack.length}` : "Edits"),
      CompareButton(ui, "bar-button"),
      button({ class: "bar-button is-primary", disabled: () => !ui.canSave(), onclick: ui.save },
        () => ui.saving.val ?? (ui.dirty.val || !ui.hasSavedEdit.val ? "Save" : "Saved")));
  };

  return div({ class: "editor-phone" }, Sheet(), Bar());
}
