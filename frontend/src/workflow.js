import { state } from "./state.js";
import { cull } from "./cull.js";
import { setStep, setFilter } from "./router.js";
import { loadCurrentProject } from "./data.js";

// The guided passes through a project's photos (docs/decisions.md, 2026-10-04):
//   - the cull pass: the loupe, one photo at a time, keep or reject, then straight on to the next
//     photo that's still undecided. Arrows and swipes move without deciding;
//   - the edit pass: the editor, through the picks in capture order. Next saves (if anything
//     changed) and opens the next pick; Finish goes on to Export.
// Steps are guided, never locked: these start a pass, but every step stays reachable.

const ADVANCE_DELAY_MS = 150; // long enough to see the choice land before the next photo

const undecided = (photoState) => photoState.val.flag === "none";

// The next undecided photo after `from`, wrapping round to earlier ones; -1 when there are none.
export function nextUndecided(from) {
  const photos = state.photos.val;
  for (let k = 1; k <= photos.length; k++) {
    const i = (from + k) % photos.length;
    if (undecided(photos[i])) return i;
  }
  return -1;
}

// Starts the cull pass on the first undecided photo. A Cull view that hides undecided photos
// (Picks, Rejects) is switched back to All first.
export async function startCullPass() {
  if (state.step.val !== "cull") await setStep("cull");
  else if (!["all", "unrated"].includes(state.filter.val.view)) await setFilter({ view: "all", minRating: 0 });
  const first = state.photos.val.findIndex(undecided);
  state.selected.val = Math.max(0, first);
  state.cullPass.val = true;
  state.loupeOpen.val = true;
}

// Keep or reject the photo in the loupe, then move on. When nothing is left undecided, the selection
// stays put and the loupe shows that the pass is complete.
export async function decide(flag) {
  const index = state.selected.val;
  const photoState = state.photos.val[index];
  if (!photoState) return;
  const done = cull(photoState, { flag });
  setTimeout(() => {
    if (!state.cullPass.val || state.selected.val !== index) return; // moved on meanwhile
    const next = nextUndecided(index);
    if (next >= 0) state.selected.val = next;
  }, ADVANCE_DELAY_MS);
  await done;
}

export const cullPassComplete = () => state.cullPass.val && state.photos.val.length > 0 && !state.photos.val.some(undecided);

export function endCullPass() {
  state.cullPass.val = false;
  state.loupeOpen.val = false;
}

// Starts the edit pass on the first pick without a saved edit (or the first pick, if all have one).
export async function startEditPass() {
  if (state.step.val !== "edit") await setStep("edit");
  const photos = state.photos.val;
  if (!photos.length) return;
  const first = photos.findIndex((p) => !p.val.hasEdit);
  state.cullPass.val = false;
  state.loupeOpen.val = false;
  state.editPass.val = true;
  state.editing.val = photos[Math.max(0, first)];
}

// Where the edit pass is: the photo's position among the picks.
export function editPassPosition(photoState) {
  const photos = state.photos.val;
  const index = photos.indexOf(photoState);
  return { index, count: photos.length, previous: photos[index - 1] ?? null, next: photos[index + 1] ?? null };
}

export function moveEditPass(photoState) {
  state.editing.val = photoState;
}

// Leaves the editor, from the pass or not. The step's counts (how many picks are edited) are
// reloaded, since saves changed them.
export function leaveEditor({ finished = false } = {}) {
  const wasPass = state.editPass.val;
  state.editPass.val = false;
  state.editing.val = null;
  if (finished && wasPass) setStep("export");
  else loadCurrentProject();
}
