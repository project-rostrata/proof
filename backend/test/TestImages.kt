import java.awt.Color
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.imageio.ImageIO

// Builders for synthetic test images. The EXIF writer emits real TIFF structures in either byte
// order: Intel ("II", e.g. Canon, phones) and Motorola ("MM", e.g. Nikon, Olympus). So the reader is
// exercised on both layouts without committing camera files.

data class ExifFields(
    val orientation: Int? = null,
    val make: String? = null,
    val model: String? = null,
    val dateTimeOriginal: String? = null,
    val offsetTimeOriginal: String? = null,
    val exposureTime: Pair<Int, Int>? = null,
    val fNumber: Pair<Int, Int>? = null,
    val iso: Int? = null,
    val focalLength: Pair<Int, Int>? = null,
    val lens: String? = null,
)

private class Entry(val tag: Int, val type: Int, val count: Int, val data: ByteArray)

fun buildTiff(fields: ExifFields, bigEndian: Boolean = false): ByteArray {
    val order = if (bigEndian) ByteOrder.BIG_ENDIAN else ByteOrder.LITTLE_ENDIAN
    fun bytes(size: Int, fill: (ByteBuffer) -> Unit) = ByteBuffer.allocate(size).order(order).also(fill).array()
    fun ascii(tag: Int, s: String) = Entry(tag, 2, s.length + 1, (s + "\u0000").toByteArray(Charsets.ISO_8859_1))
    fun short(tag: Int, v: Int) = Entry(tag, 3, 1, bytes(2) { it.putShort(v.toShort()) })
    fun rational(tag: Int, v: Pair<Int, Int>) = Entry(tag, 5, 1, bytes(8) { it.putInt(v.first); it.putInt(v.second) })

    val ifd0 = listOfNotNull(
        fields.make?.let { ascii(0x010F, it) },
        fields.model?.let { ascii(0x0110, it) },
        fields.orientation?.let { short(0x0112, it) },
    )
    val exifIfd = listOfNotNull(
        fields.exposureTime?.let { rational(0x829A, it) },
        fields.fNumber?.let { rational(0x829D, it) },
        fields.iso?.let { short(0x8827, it) },
        fields.dateTimeOriginal?.let { ascii(0x9003, it) },
        fields.offsetTimeOriginal?.let { ascii(0x9011, it) },
        fields.focalLength?.let { rational(0x920A, it) },
        fields.lens?.let { ascii(0xA434, it) },
    )
    val ifd0Size = 2 + (ifd0.size + 1) * 12 + 4 // +1 for the Exif IFD pointer
    val exifSize = 2 + exifIfd.size * 12 + 4
    val ifd0At = 8
    val exifAt = ifd0At + ifd0Size
    var dataAt = exifAt + exifSize
    val out = ByteBuffer.allocate(dataAt + (ifd0 + exifIfd).sumOf { it.data.size } + 64).order(order)
    out.put(if (bigEndian) "MM".toByteArray() else "II".toByteArray()).putShort(42).putInt(ifd0At)
    val deferred = mutableListOf<Pair<Int, ByteArray>>()
    fun writeIfd(at: Int, entries: List<Entry>, extra: Entry?) {
        out.position(at)
        val all = (entries + listOfNotNull(extra)).sortedBy { it.tag }
        out.putShort(all.size.toShort())
        for (e in all) {
            out.putShort(e.tag.toShort()).putShort(e.type.toShort()).putInt(e.count)
            if (e.data.size <= 4) {
                out.put(e.data.copyOf(4))
            } else {
                out.putInt(dataAt); deferred += dataAt to e.data; dataAt += e.data.size
            }
        }
        out.putInt(0)
    }
    writeIfd(ifd0At, ifd0, Entry(0x8769, 4, 1, bytes(4) { it.putInt(exifAt) }))
    writeIfd(exifAt, exifIfd, null)
    for ((at, data) in deferred) { out.position(at); out.put(data) }
    return out.array().copyOf(dataAt)
}

// A JPEG of the given image, with `tiff` (if any) spliced in as an Exif APP1 right after SOI.
fun jpegWithExif(image: BufferedImage, tiff: ByteArray?): ByteArray {
    val plain = ByteArrayOutputStream().also { ImageIO.write(image, "jpg", it) }.toByteArray()
    if (tiff == null) return plain
    val payload = byteArrayOf(0x45, 0x78, 0x69, 0x66, 0, 0) + tiff
    val length = payload.size + 2
    val app1 = byteArrayOf(0xFF.toByte(), 0xE1.toByte(), (length shr 8).toByte(), length.toByte()) + payload
    return plain.copyOfRange(0, 2) + app1 + plain.copyOfRange(2, plain.size)
}

fun pngBytes(image: BufferedImage): ByteArray = ByteArrayOutputStream().also { ImageIO.write(image, "png", it) }.toByteArray()

// Four solid quadrants: red top-left, green top-right, blue bottom-left, white bottom-right.
// Survives JPEG compression well enough to check which corner ended up where.
fun quadrants(w: Int, h: Int): BufferedImage {
    val img = BufferedImage(w, h, BufferedImage.TYPE_INT_RGB)
    val g = img.createGraphics()
    g.color = Color.RED; g.fillRect(0, 0, w / 2, h / 2)
    g.color = Color.GREEN; g.fillRect(w / 2, 0, w - w / 2, h / 2)
    g.color = Color.BLUE; g.fillRect(0, h / 2, w / 2, h - h / 2)
    g.color = Color.WHITE; g.fillRect(w / 2, h / 2, w - w / 2, h - h / 2)
    g.dispose()
    return img
}

// Nearest named colour of a pixel, for asserting on JPEG-compressed quadrants.
fun colourAt(img: BufferedImage, x: Int, y: Int): String {
    val rgb = img.getRGB(x, y)
    val r = (rgb shr 16) and 0xFF; val g = (rgb shr 8) and 0xFF; val b = rgb and 0xFF
    return when {
        r > 200 && g > 200 && b > 200 -> "white"
        r > 150 && g < 100 && b < 100 -> "red"
        g > 150 && r < 100 && b < 100 -> "green"
        b > 150 && r < 100 && g < 100 -> "blue"
        else -> "other($r,$g,$b)"
    }
}
