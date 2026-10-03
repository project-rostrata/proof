package proof.fs

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermissions

// Atomic writes start as Files.createTempFile, which is owner-only (rw-------). proof's files are
// the truth and meant to be readable outside the app (SMB, darktable: PROJECT_BRIEF.md §4), so each
// file gets ordinary rw-r--r-- once it's in place. Non-POSIX filesystems are left alone.
private val SHAREABLE = PosixFilePermissions.fromString("rw-r--r--")

fun makeShareable(path: Path) {
    runCatching { Files.setPosixFilePermissions(path, SHAREABLE) }
}
