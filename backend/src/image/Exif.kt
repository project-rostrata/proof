package proof.image

import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

// The handful of EXIF fields proof indexes (PROJECT_BRIEF.md §7). Raw values only. Display strings
// are built in api/Display.kt.
data class Exif(
    val orientation: Int = 1,
    val make: String? = null,
    val model: String? = null,
    val lens: String? = null,
    val captureTime: LocalDateTime? = null, // DateTimeOriginal: the camera's wall-clock time, no zone
    val captureOffset: String? = null, // OffsetTimeOriginal, e.g. "+02:00", when the camera wrote one
    val focalLengthMm: Double? = null,
    val fNumber: Double? = null,
    val exposureTimeS: Double? = null,
    val iso: Int? = null,
)

private const val TAG_MAKE = 0x010F
private const val TAG_MODEL = 0x0110
private const val TAG_ORIENTATION = 0x0112
private const val TAG_EXIF_IFD = 0x8769
private const val TAG_EXPOSURE_TIME = 0x829A
private const val TAG_F_NUMBER = 0x829D
private const val TAG_ISO = 0x8827
private const val TAG_DATE_TIME_ORIGINAL = 0x9003
private const val TAG_OFFSET_TIME_ORIGINAL = 0x9011
private const val TAG_FOCAL_LENGTH = 0x920A
private const val TAG_LENS_MODEL = 0xA434

private const val MAX_IFD_ENTRIES = 1000

private val EXIF_DATE = DateTimeFormatter.ofPattern("yyyy:MM:dd HH:mm:ss")

// A hand-written TIFF/EXIF reader (PROJECT_BRIEF.md §2: no metadata library). It reads IFD0 and
// the Exif sub-IFD only. Every offset is bounds-checked: uploaded files are untrusted
// (SECURITY.md), so malformed or hostile EXIF yields missing fields, never an exception or a hang.
object ExifReader {
    // Pulls the TIFF block out of a JPEG's "Exif\0\0" APP1 segment, or a PNG's eXIf chunk.
    // Returns null when there is none.
    fun tiffBlock(file: ByteArray): ByteArray? = when (sniff(file)) {
        ImageType.JPEG -> jpegExif(file)
        ImageType.PNG -> pngExif(file)
        null -> null
    }

    fun read(file: ByteArray): Exif = tiffBlock(file)?.let(::parseTiff) ?: Exif()

    fun parseTiff(tiff: ByteArray): Exif {
        val r = TiffBytes(tiff)
        val littleEndian = when {
            tiff.size >= 8 && tiff[0] == 'I'.code.toByte() && tiff[1] == 'I'.code.toByte() -> true
            tiff.size >= 8 && tiff[0] == 'M'.code.toByte() && tiff[1] == 'M'.code.toByte() -> false
            else -> return Exif()
        }
        r.littleEndian = littleEndian
        if (r.u16(2) != 42) return Exif()

        val tags = mutableMapOf<Int, TiffValue>()
        val visited = mutableSetOf<Long>()
        fun readIfd(offset: Long, depth: Int) {
            if (depth > 2 || !visited.add(offset) || !r.fits(offset, 2)) return
            val count = r.u16(offset).coerceAtMost(MAX_IFD_ENTRIES)
            for (i in 0 until count) {
                val entry = offset + 2 + i * 12L
                if (!r.fits(entry, 12)) return
                val tag = r.u16(entry)
                val value = r.value(entry) ?: continue
                if (tag == TAG_EXIF_IFD) {
                    value.asLong()?.let { readIfd(it, depth + 1) }
                } else {
                    tags.putIfAbsent(tag, value)
                }
            }
        }
        readIfd(r.u32(4), 0)

        return Exif(
            orientation = tags[TAG_ORIENTATION]?.asLong()?.toInt()?.takeIf { it in 1..8 } ?: 1,
            make = tags[TAG_MAKE]?.asText(),
            model = tags[TAG_MODEL]?.asText(),
            lens = tags[TAG_LENS_MODEL]?.asText(),
            captureTime = tags[TAG_DATE_TIME_ORIGINAL]?.asText()?.let { runCatching { LocalDateTime.parse(it, EXIF_DATE) }.getOrNull() },
            captureOffset = tags[TAG_OFFSET_TIME_ORIGINAL]?.asText()?.takeIf { it.matches(Regex("[+-]\\d{2}:\\d{2}")) },
            focalLengthMm = tags[TAG_FOCAL_LENGTH]?.asDouble()?.takeIf { it > 0 },
            fNumber = tags[TAG_F_NUMBER]?.asDouble()?.takeIf { it > 0 },
            exposureTimeS = tags[TAG_EXPOSURE_TIME]?.asDouble()?.takeIf { it > 0 },
            iso = tags[TAG_ISO]?.asLong()?.toInt()?.takeIf { it > 0 },
        )
    }

    private fun jpegExif(file: ByteArray): ByteArray? {
        var i = 2
        while (i + 4 <= file.size) {
            if (file[i] != 0xFF.toByte()) return null
            val marker = file[i + 1].toInt() and 0xFF
            if (marker == 0xDA || marker == 0xD9) return null // start of scan / end of image
            val length = ((file[i + 2].toInt() and 0xFF) shl 8) or (file[i + 3].toInt() and 0xFF)
            if (length < 2 || i + 2 + length > file.size) return null
            val payload = i + 4
            if (marker == 0xE1 && length >= 8 && file.copyOfRange(payload, payload + 6).contentEquals(EXIF_HEADER)) {
                return file.copyOfRange(payload + 6, i + 2 + length)
            }
            i += 2 + length
        }
        return null
    }

    private fun pngExif(file: ByteArray): ByteArray? {
        var i = 8
        while (i + 12 <= file.size) {
            val length = ((file[i].toLong() and 0xFF) shl 24) or ((file[i + 1].toLong() and 0xFF) shl 16) or
                ((file[i + 2].toLong() and 0xFF) shl 8) or (file[i + 3].toLong() and 0xFF)
            val type = String(file, i + 4, 4, Charsets.ISO_8859_1)
            if (length > file.size - i - 12) return null
            if (type == "eXIf") return file.copyOfRange(i + 8, i + 8 + length.toInt())
            if (type == "IDAT" || type == "IEND") return null // eXIf must precede the image data
            i += 12 + length.toInt()
        }
        return null
    }

    private val EXIF_HEADER = byteArrayOf(0x45, 0x78, 0x69, 0x66, 0, 0) // "Exif\0\0"
}

private class TiffValue(val type: Int, val count: Long, val bytes: ByteArray, val r: TiffBytes, val at: Long) {
    fun asLong(): Long? = when (type) {
        1, 7 -> if (count >= 1) (bytes[at.toInt()].toLong() and 0xFF) else null
        3 -> if (count >= 1) r.u16(at).toLong() else null
        4 -> if (count >= 1) r.u32(at) else null
        else -> null
    }

    fun asDouble(): Double? = when (type) {
        5 -> { val n = r.u32(at); val d = r.u32(at + 4); if (d == 0L) null else n.toDouble() / d }
        10 -> { val n = r.u32(at).toInt(); val d = r.u32(at + 4).toInt(); if (d == 0) null else n.toDouble() / d }
        3, 4 -> asLong()?.toDouble()
        else -> null
    }

    // ASCII, NUL-terminated, trimmed. Cameras pad Make/Model with trailing spaces.
    fun asText(): String? {
        if (type != 2) return null
        val end = (at + count).toInt()
        var stop = at.toInt()
        while (stop < end && bytes[stop] != 0.toByte()) stop++
        return String(bytes, at.toInt(), stop - at.toInt(), Charsets.ISO_8859_1).trim().ifEmpty { null }
    }
}

private class TiffBytes(val bytes: ByteArray) {
    var littleEndian = true

    fun fits(offset: Long, length: Long): Boolean = offset >= 0 && length >= 0 && offset + length <= bytes.size

    fun u16(offset: Long): Int {
        val a = bytes[offset.toInt()].toInt() and 0xFF
        val b = bytes[offset.toInt() + 1].toInt() and 0xFF
        return if (littleEndian) a or (b shl 8) else (a shl 8) or b
    }

    fun u32(offset: Long): Long {
        val lo = u16(if (littleEndian) offset else offset + 2).toLong()
        val hi = u16(if (littleEndian) offset + 2 else offset).toLong()
        return (hi shl 16) or lo
    }

    // Resolves a 12-byte IFD entry to where its value lives: inline if it fits in 4 bytes,
    // otherwise at the offset stored there. Out-of-bounds values are dropped.
    fun value(entry: Long): TiffValue? {
        val type = u16(entry + 2)
        val count = u32(entry + 4)
        val size = when (type) { 1, 2, 7 -> 1L; 3 -> 2L; 4 -> 4L; 5, 10 -> 8L; else -> return null }
        if (count <= 0 || count > bytes.size) return null
        val total = size * count
        val at = if (total <= 4) entry + 8 else u32(entry + 8)
        if (!fits(at, total)) return null
        return TiffValue(type, count, bytes, this, at)
    }
}
