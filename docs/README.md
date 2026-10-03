# proof — docs index

proof is a self-hosted browser photo editor. You batch-upload a project, cull and rate it, then edit the keepers with Snapseed-style tools. It has a Kotlin backend on the bare JDK stdlib (no framework), a VanJS frontend (no bundler), and an edit pipeline written in hand-made WebGL2 that runs in the browser. Files on disk are the source of truth, and Postgres is an index over them.

Keep this page short. It's an index, not a place to write things up, so put depth in the linked docs instead.

- **[../PROJECT_BRIEF.md](../PROJECT_BRIEF.md)**: the original spec, covering non-negotiable constraints, architecture, rationale, and phasing. Read this first.
- **[../V1_PLAN.md](../V1_PLAN.md)**: the phased build plan derived from the brief, starting with the WebGL2 spike.
- **[../AGENTS.md](../AGENTS.md)**: coding conventions, including the pipeline rules and the narrow dumb-UI exception. Read this before writing any code.
- **[architecture.md](architecture.md)**: living doc covering what's actually built right now.
- **[decisions.md](decisions.md)**: an append-only log of decisions and the reasons for them.
- **[handoff.md](handoff.md)**: ephemeral session-to-session state.

`deployment.md` gets added with the Docker image (Phase 13).
