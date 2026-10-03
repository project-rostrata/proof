package proof.image

import java.io.ByteArrayOutputStream

// Moving EXIF from an original onto a saved render (PROJECT_BRIEF.md §4). The browser's
// canvas.toBlob() writes no metadata at all, so the server copies the original's Exif APP1 segment
// into the render, with Orientation reset to 1, since the render is already upright. Only the Exif
// segment is copied, never the ICC profile (APP2): the render is sRGB whatever the original was
// (Phase 1 spike, docs/decisions.md). Plain byte surgery on JPEG segments, with no image library.
object JpegExif {
    private val EXIF_HEADER = byteArrayOf(0x45, 0x78, 0x69, 0x66, 0, 0) // "Exif\0\0"

    private data class Segment(val marker: Int, val start: Int, val end: Int)

    // Marker segments between SOI and the start of scan.
    private fun segments(jpeg: ByteArray): List<Segment>? {
        if (jpeg.size < 4 || jpeg[0] != 0xFF.toByte() || jpeg[1] != 0xD8.toByte()) return null
        val out = mutableListOf<Segment>()
        var i = 2
        while (i + 4 <= jpeg.size) {
            if (jpeg[i] != 0xFF.toByte()) return null
            val marker = jpeg[i + 1].toInt() and 0xFF
            if (marker == 0xDA || marker == 0xD9) break
            val length = ((jpeg[i + 2].toInt() and 0xFF) shl 8) or (jpeg[i + 3].toInt() and 0xFF)
            if (length < 2 || i + 2 + length > jpeg.size) return null
            out += Segment(marker, i, i + 2 + length)
            i += 2 + length
        }
        return out
    }

    private fun isExif(jpeg: ByteArray, s: Segment): Boolean =
        s.marker == 0xE1 && s.end - s.start >= 10 && jpeg.copyOfRange(s.start + 4, s.start + 10).contentEquals(EXIF_HEADER)

    // The whole Exif APP1 segment (marker included), or null.
    fun exifSegment(jpeg: ByteArray): ByteArray? =
        segments(jpeg)?.firstOrNull { isExif(jpeg, it) }?.let { jpeg.copyOfRange(it.start, it.end) }

    // A copy of an Exif APP1 segment with its IFD0 Orientation tag set to `value`, if it has one.
    // Bounds-checked: a malformed segment is returned unchanged.
    fun withOrientation(app1: ByteArray, value: Int): ByteArray {
        val copy = app1.copyOf()
        val tiff = 10
        if (copy.size < tiff + 8) return copy
        val little = copy[tiff] == 'I'.code.toByte()
        fun u16(at: Int) = if (little) (copy[at].toInt() and 0xFF) or ((copy[at + 1].toInt() and 0xFF) shl 8)
        else ((copy[at].toInt() and 0xFF) shl 8) or (copy[at + 1].toInt() and 0xFF)
        fun u32(at: Int) = if (little) u16(at) or (u16(at + 2) shl 16) else (u16(at) shl 16) or u16(at + 2)
        val ifd0 = tiff + u32(tiff + 4)
        if (ifd0 < tiff || ifd0 + 2 > copy.size) return copy
        val count = u16(ifd0)
        for (k in 0 until count) {
            val entry = ifd0 + 2 + k * 12
            if (entry + 12 > copy.size) break
            if (u16(entry) == 0x0112 && u16(entry + 2) == 3) {
                val at = entry + 8
                if (little) { copy[at] = value.toByte(); copy[at + 1] = 0 } else { copy[at] = 0; copy[at + 1] = value.toByte() }
            }
        }
        return copy
    }

    // `jpeg` with `app1` inserted right after SOI and any Exif segment it already had removed.
    // Null if `jpeg` isn't a well-formed JPEG.
    fun splice(jpeg: ByteArray, app1: ByteArray): ByteArray? {
        val segs = segments(jpeg) ?: return null
        val out = ByteArrayOutputStream(jpeg.size + app1.size)
        out.write(jpeg, 0, 2)
        out.write(app1)
        var i = 2
        for (s in segs.filter { isExif(jpeg, it) }) {
            out.write(jpeg, i, s.start - i)
            i = s.end
        }
        out.write(jpeg, i, jpeg.size - i)
        return out.toByteArray()
    }
}
