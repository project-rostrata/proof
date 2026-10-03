import proof.fs.Received
import proof.fs.receiveUpload
import proof.image.ImageType
import java.awt.image.BufferedImage
import java.nio.file.Files
import java.security.MessageDigest
import java.util.HexFormat
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

private fun withTmp(block: (java.nio.file.Path) -> Unit) {
    val dir = Files.createTempDirectory("proof-upload-test")
    try {
        block(dir)
    } finally {
        Files.walk(dir).sorted(Comparator.reverseOrder()).forEach { Files.delete(it) }
    }
}

private fun leftovers(dir: java.nio.file.Path) = Files.list(dir).use { it.count() }

fun testReceivesAJpegWithSizeAndHash() = withTmp { dir ->
    val bytes = jpegWithExif(BufferedImage(16, 16, BufferedImage.TYPE_INT_RGB), null)

    val result = receiveUpload(bytes.inputStream(), dir, 1_000_000)

    assertIs<Received.File>(result)
    assertEquals(ImageType.JPEG, result.type)
    assertEquals(bytes.size.toLong(), result.sizeBytes)
    assertEquals(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)), result.sha256)
    assertTrue(Files.readAllBytes(result.path).contentEquals(bytes))
}

fun testOverTheCapIsRejectedAndCleanedUp() = withTmp { dir ->
    val bytes = jpegWithExif(BufferedImage(64, 64, BufferedImage.TYPE_INT_RGB), null)

    val result = receiveUpload(bytes.inputStream(), dir, (bytes.size - 1).toLong())

    assertIs<Received.TooLarge>(result)
    assertEquals(0L, leftovers(dir))
}

fun testNonImagesAreRejectedAndCleanedUp() = withTmp { dir ->
    val result = receiveUpload("<html>definitely not a photo</html>".byteInputStream(), dir, 1_000_000)

    assertIs<Received.NotAnImage>(result)
    assertEquals(0L, leftovers(dir))
}
