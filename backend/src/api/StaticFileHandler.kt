package proof.api

import proof.fs.Rejected
import proof.fs.Resolved
import proof.fs.resolveUnderRoot
import java.nio.file.Files
import java.nio.file.Path

// Serves the frontend's static files, through the same path-safety check as everything else.
// Copied from shelf's StaticFileHandler.kt.
class StaticFileHandler(private val root: Path) {
    fun serve(requestPath: String): StreamResult {
        val relative = if (requestPath == "/" || requestPath.isEmpty()) "index.html" else requestPath
        val resolved = when (val result = resolveUnderRoot(root, relative)) {
            is Resolved -> result.path
            is Rejected -> return StreamFailed(Err(403, "FORBIDDEN", result.reason))
        }
        if (!Files.isRegularFile(resolved)) {
            return StreamFailed(Err(404, "NOT_FOUND", "No such file: $requestPath"))
        }

        return FileStream(
            contentType = contentTypeFor(resolved),
            fileName = resolved.fileName.toString(),
            contentLength = Files.size(resolved),
            asAttachment = false,
        ) { output -> Files.newInputStream(resolved).use { it.copyTo(output) } }
    }

    // Extension-based, not Files.probeContentType() — browsers are strict about
    // Content-Type: text/javascript for <script type="module">, and probeContentType()'s
    // OS-level MIME detection isn't reliable on a minimal container image.
    private fun contentTypeFor(path: Path): String = when (path.toString().substringAfterLast('.', "")) {
        "html" -> "text/html; charset=utf-8"
        "js" -> "text/javascript; charset=utf-8"
        "css" -> "text/css; charset=utf-8"
        "json" -> "application/json; charset=utf-8"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "ico" -> "image/x-icon"
        else -> "application/octet-stream"
    }
}
