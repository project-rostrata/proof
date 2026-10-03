import proof.image.ImageType
import proof.image.sniff
import java.awt.image.BufferedImage
import kotlin.test.assertEquals
import kotlin.test.assertNull

fun testSniffsJpegAndPng() {
    val img = BufferedImage(4, 4, BufferedImage.TYPE_INT_RGB)
    assertEquals(ImageType.JPEG, sniff(jpegWithExif(img, null)))
    assertEquals(ImageType.PNG, sniff(pngBytes(img)))
}

fun testRejectsEverythingElse() {
    assertNull(sniff(ByteArray(0)))
    assertNull(sniff("GIF89a....".toByteArray()))
    assertNull(sniff("<html>".toByteArray()))
    assertNull(sniff(byteArrayOf(0xFF.toByte(), 0xD8.toByte()))) // truncated JPEG signature
}
