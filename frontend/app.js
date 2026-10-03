import van from "./lib/van-1.6.1.js";

const { main, h1, p } = van.tags;

// Scaffold only (V1_PLAN.md Phase 2). Views land in src/views/ from Phase 5 onwards, and the edit
// pipeline in src/pipeline/ from Phase 8.
function Root() {
  return main({ class: "scaffold" },
    h1("proof"),
    p("Upload, cull, edit. Nothing is wired up yet."),
  );
}

van.add(document.getElementById("app"), Root());
