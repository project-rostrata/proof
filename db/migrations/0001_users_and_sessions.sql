-- Accounts, as in shelf (PROJECT_BRIEF.md §5: shelf-style accounts), minus the email, is_admin,
-- and quota columns proof has no use for. Each user's projects live on disk under
-- $PROOF_DATA/<username>/. projects and photos land in Phase 5 with the code that fills them.
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- id has no default: session tokens are generated explicitly in Kotlin with a CSPRNG
-- (UUID.randomUUID), not left to the database.
CREATE TABLE sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
