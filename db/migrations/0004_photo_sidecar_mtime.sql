-- Reconciliation (V1_PLAN.md Phase 6): the XMP sidecar's mtime when the index last read or wrote it,
-- so a sidecar changed by another tool (darktable, Lightroom) is noticed and re-read. NULL means no
-- sidecar has been seen. Existing rows start NULL, so the first pass reads every existing sidecar.
ALTER TABLE photos ADD COLUMN sidecar_mtime TIMESTAMPTZ;
