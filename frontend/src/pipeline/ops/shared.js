// Helpers shared by the tools.

// Sliders run -100..100 (or 0..100) with 0 the identity. The response is gentle near zero and
// full strength at the ends (|v|^1.5), so small nudges stay small. The Phase 1 spike found
// mini-gl's linear sliders too sensitive. Returns -1..1.
export function shape(value) {
  const s = Math.max(-1, Math.min(1, value / 100));
  return Math.sign(s) * Math.abs(s) ** 1.5;
}

export const slider = (id, label, { min = -100, max = 100 } = {}) => ({ id, label, min, max, default: 0 });

export const allZero = (params, ids) => ids.every((id) => params[id] === 0);
