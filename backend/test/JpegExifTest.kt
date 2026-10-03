import proof.image.ExifReader
import proof.image.JpegExif
import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import javax.imageio.ImageIO
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val ORIGINAL = jpegWithExif(quadrants(64, 48), buildTiff(ExifFields(orientation = 6, make = "Google", model = "Pixel 7a", dateTimeOriginal = "2026:09:30 08:37:03")))
private val RENDER = jpegWithExif(quadrants(48, 64), null) // what canvas.toBlob produces: no EXIF

fun testRenderFromTheBrowserHasNoExifUntilSpliced() {
    assertNull(JpegExif.exifSegment(RENDER))
    assertNotNull(JpegExif.exifSegment(ORIGINAL))
}

// The render is already upright, so its copied EXIF must say orientation 1, or viewers would
// rotate it a second time. Everything else is carried over.
fun testSplicedRenderCarriesTheOriginalsExifWithOrientationReset() {
    val app1 = JpegExif.withOrientation(JpegExif.exifSegment(ORIGINAL)!!, 1)
    val spliced = JpegExif.splice(RENDER, app1)!!
    val exif = ExifReader.read(spliced)
    assertEquals(1, exif.orientation)
    assertEquals("Google", exif.make)
    assertEquals("Pixel 7a", exif.model)
    assertEquals(2026, exif.captureTime?.year)
    val decoded = ImageIO.read(ByteArrayInputStream(spliced))
    assertEquals(48 to 64, decoded.width to decoded.height)
}

fun testSplicingTwiceKeepsOneExifSegment() {
    val app1 = JpegExif.exifSegment(ORIGINAL)!!
    val twice = JpegExif.splice(JpegExif.splice(RENDER, app1)!!, app1)!!
    val count = (0 until twice.size - 10).count { i ->
        twice[i] == 0xFF.toByte() && twice[i + 1] == 0xE1.toByte() && twice.copyOfRange(i + 4, i + 10).contentEquals(byteArrayOf(0x45, 0x78, 0x69, 0x66, 0, 0))
    }
    assertEquals(1, count)
}

fun testOrientationResetWorksInBothByteOrders() {
    for (bigEndian in listOf(false, true)) {
        val jpeg = jpegWithExif(BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB), buildTiff(ExifFields(orientation = 8), bigEndian))
        val reset = JpegExif.withOrientation(JpegExif.exifSegment(jpeg)!!, 1)
        assertEquals(1, ExifReader.read(JpegExif.splice(jpeg, reset)!!).orientation, "bigEndian=$bigEndian")
    }
}

fun testMalformedInputIsRefusedNotCrashed() {
    assertNull(JpegExif.splice("not a jpeg".toByteArray(), JpegExif.exifSegment(ORIGINAL)!!))
    val truncated = JpegExif.withOrientation(byteArrayOf(0xFF.toByte(), 0xE1.toByte(), 0, 4), 1)
    assertTrue(truncated.size == 4)
}
