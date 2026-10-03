package proof.fs

import proof.image.ImageType
import proof.image.sniff
import java.io.InputStream
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.util.HexFormat

sealed class Received {
    data class File(val path: Path, val sizeBytes: Long, val sha256: String, val type: ImageType) : Received()
    data object TooLarge : Received()
    data object NotAnImage : Received()
}

// Streams one upload into a temp file under `tmpDir`, enforcing the size cap while it reads (a
// Content-Length header can't be trusted), hashing as it goes, and sniffing the type from the
// first bytes. The caller owns the returned file. Anything other than Received.File leaves no
// file behind.
fun receiveUpload(body: InputStream, tmpDir: Path, maxBytes: Long): Received {
    Files.createDirectories(tmpDir)
    val tmp = Files.createTempFile(tmpDir, "upload-", ".part")
    var keep = false
    try {
        val digest = MessageDigest.getInstance("SHA-256")
        val head = ByteArray(16)
        var headLength = 0
        var total = 0L
        Files.newOutputStream(tmp).use { out ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val n = body.read(buffer)
                if (n < 0) break
                total += n
                if (total > maxBytes) return Received.TooLarge
                if (headLength < head.size) {
                    val take = minOf(n, head.size - headLength)
                    System.arraycopy(buffer, 0, head, headLength, take)
                    headLength += take
                }
                digest.update(buffer, 0, n)
                out.write(buffer, 0, n)
            }
        }
        val type = sniff(head.copyOf(headLength)) ?: return Received.NotAnImage
        keep = true
        return Received.File(tmp, total, HexFormat.of().formatHex(digest.digest()), type)
    } finally {
        if (!keep) Files.deleteIfExists(tmp)
    }
}
