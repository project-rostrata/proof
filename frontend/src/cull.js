import { state, showError } from "./state.js";
import { api, ApiError } from "./api.js";

// Culling keys, the Lightroom/Photo Mechanic conventions: 0-5 stars, P pick, X reject, U unflag,
// arrows move, Enter/Space opens the loupe, Esc closes it.
export const KEY_HELP = "0–5 rate · P pick · X reject · U unflag · arrows move · Enter loupe · E edit · Esc close";

// Optimistic: the frame updates the moment the key is pressed (it's echoing the user's own input),
// then takes the server's version of the photo, plus the server's recounted view totals. On
// failure it reverts.
export async function cull(photoState, change) {
  const before = photoState.val;
  photoState.val = { ...before, ...change };
  try {
    const { photo, views } = await api.cull(before.id, change);
    photoState.val = photo;
    state.current.val = { ...state.current.val, views };
  } catch (e) {
    photoState.val = before;
    showError(e instanceof ApiError ? e.message : "Could not save that change");
  }
}

function select(index) {
  const count = state.photos.val.length;
  if (!count) return;
  state.selected.val = Math.max(0, Math.min(count - 1, index));
  document.querySelectorAll(".frame")[state.selected.val]?.scrollIntoView({ block: "nearest" });
}

// Columns in the contact sheet as currently laid out, for up/down movement.
function columns() {
  const frames = document.querySelectorAll(".frame");
  if (!frames.length) return 1;
  const top = frames[0].offsetTop;
  let n = 0;
  while (n < frames.length && frames[n].offsetTop === top) n++;
  return Math.max(1, n);
}

export function handleKey(e) {
  if (state.editing.val) return; // the editor has its own keys
  if (!state.projectId.val || !state.photos.val.length) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const photoState = state.photos.val[state.selected.val];
  const loupe = state.loupeOpen.val;
  const key = e.key;

  if (key >= "0" && key <= "5") cull(photoState, { rating: Number(key) });
  else if (key === "p" || key === "P") cull(photoState, { flag: "pick" });
  else if (key === "x" || key === "X") cull(photoState, { flag: "reject" });
  else if (key === "u" || key === "U") cull(photoState, { flag: "none" });
  else if (key === "ArrowRight") select(state.selected.val + 1);
  else if (key === "ArrowLeft") select(state.selected.val - 1);
  else if (key === "ArrowDown" && !loupe) select(state.selected.val + columns());
  else if (key === "ArrowUp" && !loupe) select(state.selected.val - columns());
  else if ((key === "Enter" || key === " ") && !loupe) state.loupeOpen.val = true;
  else if (key === "e" || key === "E") state.editing.val = photoState;
  else if (key === "Escape" && loupe) state.loupeOpen.val = false;
  else return;
  e.preventDefault();
}
