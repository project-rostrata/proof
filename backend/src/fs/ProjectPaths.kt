package proof.fs

import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.StandardCopyOption

// On-disk layout (PROJECT_BRIEF.md §3):
//   $PROOF_DATA/<username>/<project>/originals/   uploaded files, never modified
//   $PROOF_DATA/<username>/<project>/edits/       browser renders + recipes (Phase 11)
//   $PROOF_DATA/.cache/                           thumbnails/previews, derived and deletable
//   $PROOF_DATA/.tmp/                             in-flight uploads, cleared at startup
fun cacheRoot(dataRoot: Path): Path = dataRoot.resolve(".cache")
fun tmpRoot(dataRoot: Path): Path = dataRoot.resolve(".tmp")
fun originalsDir(projectRoot: Path): Path = projectRoot.resolve("originals")
fun editsDir(projectRoot: Path): Path = projectRoot.resolve("edits")

// Characters that can't be in a project or photo name. Path separators and control characters
// are unsafe outright. The rest are illegal on Windows/SMB, and the project tree is meant to be
// browsable over SMB (PROJECT_BRIEF.md §4).
private val FORBIDDEN = Regex("""[/\\:*?"<>|\x00-\x1F\x7F]""")

// One path segment that's safe and portable. A leading dot is reserved (it would also hide the
// entry on Unix). Leading or trailing whitespace and trailing dots are mangled by Windows/SMB.
private fun isSafeSegment(name: String, maxLength: Int): Boolean =
    name.length in 1..maxLength &&
        !FORBIDDEN.containsMatchIn(name) &&
        !name.startsWith(".") &&
        name == name.trim() &&
        !name.endsWith(".")

fun isValidProjectName(name: String): Boolean = isSafeSegment(name, 100)

// A saved edit lives next to the originals, in edits/: the render, named like its original
// (IMG_0001.jpg -> edits/IMG_0001.jpg, scan.png -> edits/scan.png.jpg, since a render is always a
// JPEG), and the recipe, edits/<original filename>.recipe.json (PROJECT_BRIEF.md §3).
fun renderName(originalFilename: String): String =
    if (originalFilename.substringAfterLast('.').lowercase() in setOf("jpg", "jpeg")) originalFilename else "$originalFilename.jpg"

fun recipeName(originalFilename: String): String = "$originalFilename.recipe.json"

private val PHOTO_EXTENSIONS = setOf("jpg", "jpeg", "png")

fun isValidPhotoFilename(name: String): Boolean =
    isSafeSegment(name, 200) && name.substringAfterLast('.', "").lowercase() in PHOTO_EXTENSIONS

// A validated name, resolved through the path-safety check anyway (AGENTS.md "Security rules": a
// client-supplied name never goes straight into Path.resolve). Null if either check fails.
fun resolveChild(parent: Path, name: String, isValid: (String) -> Boolean): Path? {
    if (!isValid(name)) return null
    return when (val result = resolveUnderRoot(parent, name)) {
        is Resolved -> result.path
        is Rejected -> null
    }
}

// Renames a directory, refusing if anything already exists at `to`. That includes an *empty*
// directory: an atomic move is rename(2) on Linux, which silently replaces an empty target
// directory. Without this check, renaming a project onto an empty project's name destroyed the
// other project's directory (found in the Phase 5 smoke test).
fun renameDirectory(from: Path, to: Path): Boolean {
    if (Files.exists(to, LinkOption.NOFOLLOW_LINKS)) return false
    return try {
        Files.move(from, to, StandardCopyOption.ATOMIC_MOVE)
        true
    } catch (e: FileAlreadyExistsException) {
        false
    }
}
