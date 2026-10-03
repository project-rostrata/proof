import proof.image.Rendition
import proof.image.Renditions
import proof.image.downscale
import proof.image.probeSize
import java.nio.file.Files
import java.nio.file.Path
import javax.imageio.ImageIO
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private fun withTemp(block: (Path) -> Unit) {
    val dir = Files.createTempDirectory("proof-renditions-test")
    try {
        block(dir)
    } finally {
        Files.walk(dir).sorted(Comparator.reverseOrder()).forEach { Files.delete(it) }
    }
}

// A 3000x2000 landscape stored with orientation 6 is a 2000x3000 portrait when upright. Both
// renditions must be upright, at the right size, and with the quadrants where a viewer sees them.
fun testRenditionsAreUprightAndSized() = withTemp { dir ->
    val source = dir.resolve("IMG_0001.jpg")
    Files.write(source, jpegWithExif(quadrants(3000, 2000), buildTiff(ExifFields(orientation = 6))))
    val renditions = Renditions(dir.resolve("cache"), 1)
    val id = java.util.UUID.randomUUID()

    renditions.ensure(id, source, 6)

    val preview = ImageIO.read(renditions.path(id, Rendition.PREVIEW).toFile())
    val thumb = ImageIO.read(renditions.path(id, Rendition.THUMB).toFile())
    assertEquals(1365 to 2048, preview.width to preview.height)
    assertEquals(267 to 400, thumb.width to thumb.height)
    // Rotating the stored image 90 CW puts its bottom-left (blue) at the top-left, its top-left
    // (red) at the top-right, white at the bottom-left, and green at the bottom-right.
    for (img in listOf(preview, thumb)) {
        assertEquals("blue", colourAt(img, img.width / 4, img.height / 4))
        assertEquals("red", colourAt(img, img.width * 3 / 4, img.height / 4))
        assertEquals("white", colourAt(img, img.width / 4, img.height * 3 / 4))
        assertEquals("green", colourAt(img, img.width * 3 / 4, img.height * 3 / 4))
    }
}

fun testSmallImagesAreNotUpscaled() = withTemp { dir ->
    val source = dir.resolve("small.png")
    Files.write(source, pngBytes(quadrants(300, 200)))
    val renditions = Renditions(dir.resolve("cache"), 1)
    val id = java.util.UUID.randomUUID()

    renditions.ensure(id, source, 1)

    val preview = ImageIO.read(renditions.path(id, Rendition.PREVIEW).toFile())
    assertEquals(300 to 200, preview.width to preview.height)
}

fun testDeleteRemovesTheCacheEntry() = withTemp { dir ->
    val source = dir.resolve("a.jpg")
    Files.write(source, jpegWithExif(quadrants(100, 100), null))
    val renditions = Renditions(dir.resolve("cache"), 1)
    val id = java.util.UUID.randomUUID()
    renditions.ensure(id, source, 1)

    renditions.delete(id)

    assertFalse(Files.exists(renditions.path(id, Rendition.THUMB)))
    assertTrue(Files.exists(dir.resolve("cache"))) // only that photo's entry goes
}

fun testProbeSizeReadsStoredDimensionsWithoutDecoding() = withTemp { dir ->
    val source = dir.resolve("a.jpg")
    Files.write(source, jpegWithExif(quadrants(640, 480), buildTiff(ExifFields(orientation = 6))))
    assertEquals(640 to 480, probeSize(source)) // stored, not oriented
}

fun testDownscaleHitsTheExactLongEdge() {
    val out = downscale(quadrants(6000, 4000), 2048)
    assertEquals(2048 to 1365, out.width to out.height)
}
