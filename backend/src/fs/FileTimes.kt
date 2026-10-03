package proof.fs

import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.time.Instant
import java.time.temporal.ChronoUnit

// A file's mtime at the precision Postgres stores (microseconds). Linux file times carry
// nanoseconds, so comparing a raw mtime with one read back from the index would find every file
// "changed" on every reconciliation pass. Every mtime that goes into the index goes through here.
fun fileMtime(path: Path): Instant = truncateToIndex(Files.getLastModifiedTime(path, LinkOption.NOFOLLOW_LINKS).toInstant())

fun truncateToIndex(instant: Instant): Instant = instant.truncatedTo(ChronoUnit.MICROS)
