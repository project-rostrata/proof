import proof.image.applyOrientation
import proof.image.swapsDimensions
import java.awt.image.BufferedImage
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// For each EXIF orientation, build the *stored* image a camera would write for a given upright
// picture. This is done independently, with plain pixel loops written from the EXIF spec's table,
// not with the transforms under test. Then check that applyOrientation recovers the upright picture
// exactly.
private fun storedFor(upright: BufferedImage, orientation: Int): BufferedImage {
    val w = upright.width
    val h = upright.height
    val swap = orientation in 5..8
    val stored = BufferedImage(if (swap) h else w, if (swap) w else h, BufferedImage.TYPE_INT_RGB)
    for (y in 0 until h) for (x in 0 until w) {
        // (sx, sy): where upright pixel (x, y) sits in the stored image.
        val (sx, sy) = when (orientation) {
            1 -> x to y
            2 -> (w - 1 - x) to y
            3 -> (w - 1 - x) to (h - 1 - y)
            4 -> x to (h - 1 - y)
            5 -> y to x
            6 -> y to (w - 1 - x) //           stored rotated 90 CCW; displaying rotates it 90 CW
            7 -> (h - 1 - y) to (w - 1 - x)
            else -> (h - 1 - y) to x //        8: stored rotated 90 CW; displaying rotates it 90 CCW
        }
        stored.setRGB(sx, sy, upright.getRGB(x, y))
    }
    return stored
}

// Every pixel distinct, so any wrong mapping shows up.
private fun distinctPixels(w: Int, h: Int): BufferedImage {
    val img = BufferedImage(w, h, BufferedImage.TYPE_INT_RGB)
    for (y in 0 until h) for (x in 0 until w) img.setRGB(x, y, (y * w + x) * 1000 + 7)
    return img
}

fun testAllEightOrientationsRecoverTheUprightImage() {
    val upright = distinctPixels(5, 3)
    for (orientation in 1..8) {
        val result = applyOrientation(storedFor(upright, orientation), orientation)
        assertEquals(upright.width, result.width, "width, orientation $orientation")
        assertEquals(upright.height, result.height, "height, orientation $orientation")
        for (y in 0 until upright.height) for (x in 0 until upright.width) {
            assertEquals(upright.getRGB(x, y), result.getRGB(x, y), "pixel ($x,$y), orientation $orientation")
        }
    }
}

fun testOnlyQuarterTurnOrientationsSwapDimensions() {
    for (o in 1..4) assertFalse(swapsDimensions(o))
    for (o in 5..8) assertTrue(swapsDimensions(o))
}
