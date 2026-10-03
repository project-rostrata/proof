package proof.fs

import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path

sealed class PathResolution
data class Resolved(val path: Path) : PathResolution()
data class Rejected(val reason: String) : PathResolution()

// Copied from shelf's fs/PathSafety.kt (resolveUserPath there), renamed to resolveUnderRoot because
// proof resolves against several kinds of root (the frontend directory, a user's data directory, a
// project directory), not only a user's home. The algorithm is unchanged. AGENTS.md "Security
// rules": every path built from a client-supplied string goes through this first.
//
// Lexical normalize() alone catches ".." traversal but not a symlink planted on an existing
// ancestor, so the deepest *existing* ancestor gets a real toRealPath() check too.
fun resolveUnderRoot(userRoot: Path, requestedPath: String): PathResolution {
    val userRootReal = try {
        userRoot.toRealPath()
    } catch (e: IOException) {
        return Rejected("user root does not exist: $userRoot")
    }

    val cleaned = requestedPath.trimStart('/')
    val candidate = userRootReal.resolve(cleaned).normalize()
    if (!candidate.startsWith(userRootReal)) {
        return Rejected("resolved path escapes user root")
    }

    var existing = candidate
    var remainder = listOf<String>()
    while (!Files.exists(existing)) {
        val parent = existing.parent ?: return Rejected("resolved path escapes user root")
        remainder = listOf(existing.fileName.toString()) + remainder
        existing = parent
    }

    val existingReal = try {
        existing.toRealPath()
    } catch (e: IOException) {
        return Rejected("resolved path escapes user root")
    }
    if (!existingReal.startsWith(userRootReal)) {
        return Rejected("resolved path escapes user root")
    }

    val resolved = remainder.fold(existingReal) { acc, segment -> acc.resolve(segment) }
    if (!resolved.startsWith(userRootReal)) {
        return Rejected("resolved path escapes user root")
    }

    return Resolved(resolved)
}
