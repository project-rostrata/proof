import proof.image.ExifReader
import java.awt.image.BufferedImage
import java.time.LocalDateTime
import kotlin.test.assertEquals
import kotlin.test.assertNull

private val FULL = ExifFields(
    orientation = 6,
    make = "OLYMPUS IMAGING CORP.  ",
    model = "E-PL7           ",
    dateTimeOriginal = "2026:09:26 16:11:55",
    offsetTimeOriginal = "+02:00",
    exposureTime = 1 to 250,
    fNumber = 28 to 10,
    iso = 200,
    focalLength = 17 to 1,
    lens = "M.17mm F1.8",
)

private fun assertFullyParsed(tiff: ByteArray) {
    val exif = ExifReader.parseTiff(tiff)
    assertEquals(6, exif.orientation)
    assertEquals("OLYMPUS IMAGING CORP.", exif.make) // trailing padding trimmed
    assertEquals("E-PL7", exif.model)
    assertEquals("M.17mm F1.8", exif.lens)
    assertEquals(LocalDateTime.of(2026, 9, 26, 16, 11, 55), exif.captureTime)
    assertEquals("+02:00", exif.captureOffset)
    assertEquals(0.004, exif.exposureTimeS)
    assertEquals(2.8, exif.fNumber)
    assertEquals(200, exif.iso)
    assertEquals(17.0, exif.focalLengthMm)
}

fun testParsesIntelByteOrder() = assertFullyParsed(buildTiff(FULL, bigEndian = false))

fun testParsesMotorolaByteOrder() = assertFullyParsed(buildTiff(FULL, bigEndian = true))

fun testExtractsExifFromJpegApp1() {
    val jpeg = jpegWithExif(BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB), buildTiff(FULL))
    assertEquals(6, ExifReader.read(jpeg).orientation)
}

fun testJpegWithoutExifGivesDefaults() {
    val exif = ExifReader.read(jpegWithExif(BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB), null))
    assertEquals(1, exif.orientation)
    assertNull(exif.captureTime)
}

fun testPngWithoutExifGivesDefaults() {
    assertEquals(1, ExifReader.read(pngBytes(BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB))).orientation)
}

fun testOutOfRangeOrientationFallsBackToUpright() {
    assertEquals(1, ExifReader.parseTiff(buildTiff(ExifFields(orientation = 9))).orientation)
    assertEquals(1, ExifReader.parseTiff(buildTiff(ExifFields(orientation = 0))).orientation)
}

fun testUnparseableDateIsDropped() {
    assertNull(ExifReader.parseTiff(buildTiff(ExifFields(dateTimeOriginal = "0000:00:00 00:00:00"))).captureTime)
}

// Untrusted input (SECURITY.md): truncation, garbage, and hostile offsets must yield defaults, not
// exceptions or hangs.
fun testTruncatedTiffNeverThrows() {
    val full = buildTiff(FULL)
    for (length in 0 until full.size) ExifReader.parseTiff(full.copyOf(length))
}

fun testGarbageNeverThrows() {
    val random = java.util.Random(42)
    repeat(2000) {
        val bytes = ByteArray(random.nextInt(200)).also(random::nextBytes)
        if (bytes.size > 4) { bytes[0] = 'I'.code.toByte(); bytes[1] = 'I'.code.toByte(); bytes[2] = 42; bytes[3] = 0 }
        ExifReader.parseTiff(bytes)
        ExifReader.read(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte()) + bytes)
    }
}

// An Exif IFD pointer that points back at IFD0 must not loop forever.
fun testSelfReferencingIfdTerminates() {
    val tiff = buildTiff(ExifFields(orientation = 3))
    val buffer = java.nio.ByteBuffer.wrap(tiff).order(java.nio.ByteOrder.LITTLE_ENDIAN)
    val count = buffer.getShort(8).toInt()
    for (i in 0 until count) {
        val entry = 10 + i * 12
        if (buffer.getShort(entry).toInt() and 0xFFFF == 0x8769) buffer.putInt(entry + 8, 8)
    }
    assertEquals(3, ExifReader.parseTiff(tiff).orientation)
}
