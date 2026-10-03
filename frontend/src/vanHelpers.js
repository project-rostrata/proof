import van from "../lib/van-1.6.1.js";

// A VanJS reactive binding whose *first* invocation returns bare `null` never becomes a real,
// connected DOM node (van.js's bind() leaves its _dom as null in that case), so it's silently
// excluded from every future update — even once later invocations would return real content.
// Confirmed by reading van.js's source after a real browser run showed a dialog/toast/menu that
// should have appeared never did. Every conditional binding that can start out empty returns
// this instead of `null`. (Learned in shelf; see its docs/decisions.md.)
export function emptyNode() {
  return van.tags.span({ style: "display:none" });
}
