-- proof no longer has colour labels: only stars and pick/reject (docs/decisions.md, 2026-10-03).
-- A label another tool wrote stays in the XMP sidecar, which proof leaves untouched.
ALTER TABLE photos DROP COLUMN label;
