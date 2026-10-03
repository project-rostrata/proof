package proof.image

import java.awt.geom.AffineTransform
import java.awt.image.AffineTransformOp
import java.awt.image.BufferedImage

// EXIF orientations 5-8 store the image rotated a quarter turn, so the upright picture has its
// width and height swapped.
fun swapsDimensions(orientation: Int): Boolean = orientation in 5..8

// Returns the upright image for an EXIF orientation (1 = already upright). Each case maps a stored
// pixel (x, y) of a w x h image to its upright position (u, v), written out as the matrix
//   u = m00*x + m01*y + m02,   v = m10*x + m11*y + m12
// (the argument order of AffineTransform's six-value constructor is m00, m10, m01, m11, m02, m12).
fun applyOrientation(image: BufferedImage, orientation: Int): BufferedImage {
    if (orientation !in 2..8) return image
    val w = image.width.toDouble()
    val h = image.height.toDouble()
    val t = when (orientation) {
        2 -> AffineTransform(-1.0, 0.0, 0.0, 1.0, w, 0.0) //    mirror horizontal: u = w - x, v = y
        3 -> AffineTransform(-1.0, 0.0, 0.0, -1.0, w, h) //     rotate 180:        u = w - x, v = h - y
        4 -> AffineTransform(1.0, 0.0, 0.0, -1.0, 0.0, h) //    mirror vertical:   u = x,     v = h - y
        5 -> AffineTransform(0.0, 1.0, 1.0, 0.0, 0.0, 0.0) //   transpose:         u = y,     v = x
        6 -> AffineTransform(0.0, 1.0, -1.0, 0.0, h, 0.0) //    rotate 90 CW:      u = h - y, v = x
        7 -> AffineTransform(0.0, -1.0, -1.0, 0.0, h, w) //     transverse:        u = h - y, v = w - x
        else -> AffineTransform(0.0, -1.0, 1.0, 0.0, 0.0, w) // 8, rotate 90 CCW:  u = y,     v = w - x
    }
    val (outW, outH) = if (swapsDimensions(orientation)) image.height to image.width else image.width to image.height
    val out = BufferedImage(outW, outH, BufferedImage.TYPE_INT_RGB)
    AffineTransformOp(t, AffineTransformOp.TYPE_NEAREST_NEIGHBOR).filter(image, out)
    return out
}
