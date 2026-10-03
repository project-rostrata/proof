-- Projects and photos (PROJECT_BRIEF.md §7). Like everything in Postgres, this is an index over
-- the filesystem: a project is the directory $PROOF_DATA/<username>/<name>/, and a photo is a file
-- in its originals/ folder. Every column here can be rebuilt from disk (Phase 6 reconciliation).
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, -- also the directory name
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner_id, name)
);

CREATE TABLE photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename TEXT NOT NULL, -- in the project's originals/
    size_bytes BIGINT NOT NULL,
    mtime TIMESTAMPTZ NOT NULL,
    content_sha256 TEXT NOT NULL,
    -- Upright dimensions: already swapped for EXIF orientations 5-8.
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    orientation SMALLINT NOT NULL DEFAULT 1 CHECK (orientation BETWEEN 1 AND 8),
    -- EXIF DateTimeOriginal is the camera's wall-clock time with no zone, so it's stored as such;
    -- OffsetTimeOriginal is kept alongside when the camera wrote one.
    capture_time TIMESTAMP,
    capture_offset TEXT,
    camera_make TEXT,
    camera_model TEXT,
    lens TEXT,
    focal_length_mm DOUBLE PRECISION,
    f_number DOUBLE PRECISION,
    exposure_time_s DOUBLE PRECISION,
    iso INTEGER,
    -- Cull state (Phase 7). The XMP sidecar next to the original is the truth; these mirror it.
    rating SMALLINT NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
    flag TEXT NOT NULL DEFAULT 'none' CHECK (flag IN ('none', 'pick', 'reject')),
    label TEXT,
    -- Edit state (Phase 11). The render and recipe files in edits/ are the truth.
    has_edit BOOLEAN NOT NULL DEFAULT false,
    edit_mtime TIMESTAMPTZ,
    recipe_version INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, filename)
);
CREATE INDEX photos_project_id_idx ON photos(project_id);
