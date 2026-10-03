package proof.fs

import java.nio.file.Path

// Each user's projects live under $PROOF_DATA/<username>/ (PROJECT_BRIEF.md §3). The directory is
// named by username, not id, the same choice shelf made: the tree stays readable from outside the
// app (SMB, darktable), and an existing username-keyed directory can be bind-mounted in as-is.
fun userRoot(dataRoot: Path, username: String): Path = dataRoot.resolve(username)

// A username is used directly as one path segment under $PROOF_DATA, so it must be safe as one.
// This is shelf's rule with one addition: no leading dot. Leading-dot names under $PROOF_DATA are
// proof's own (".cache/" holds thumbnails and previews), so a user called ".cache" must never exist.
// The rule also covers "." and "..".
private val VALID_USERNAME = Regex("^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$")

fun isValidUsername(username: String): Boolean = VALID_USERNAME.matches(username)
