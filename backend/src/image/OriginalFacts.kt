package proof.image

import java.nio.file.Files
import java.nio.file.Path

// EXIF lives in the first segments of a JPEG (APP1 is capped at 64 KB) or before IDAT in a PNG,
// so only the head of the file is read for it.
private const val EXIF_SCAN_BYTES = 1 shl 20

// What the index records about an original that comes from reading the image itself: its upright
// size (already swapped for EXIF orientations 5-8) and its EXIF. Shared by upload and
// reconciliation, so a photo is described the same way however it arrived.
data class OriginalFacts(val width: Int, val height: Int, val exif: Exif)

// Null when the file can't be decoded as an image.
fun readOriginalFacts(file: Path): OriginalFacts? {
    val (storedW, storedH) = probeSize(file) ?: return null
    val exif = ExifReader.read(Files.newInputStream(file).use { it.readNBytes(EXIF_SCAN_BYTES) })
    val swap = swapsDimensions(exif.orientation)
    return OriginalFacts(if (swap) storedH else storedW, if (swap) storedW else storedH, exif)
}
