package proof.image

import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Semaphore
import javax.imageio.IIOImage
import javax.imageio.ImageIO
import javax.imageio.ImageWriteParam
import javax.imageio.stream.FileImageOutputStream

private const val JPEG_QUALITY = 0.85f

// The derived JPEGs proof serves instead of originals (PROJECT_BRIEF.md §4): a grid thumbnail and
// a loupe/edit preview, both upright, cached under $PROOF_DATA/.cache/<photoId>/. They're always
// regenerable, so losing the cache is never data loss.
enum class Rendition(val longEdge: Int, val fileName: String) {
    THUMB(400, "thumb.jpg"),
    PREVIEW(2048, "preview.jpg"),
}

class Renditions(private val cacheRoot: Path, decodeSlots: Int) {
    // A decoded 24 MP image is ~100 MB of heap. The semaphore caps how many are decoded at once, so
    // a big batch upload can't exhaust the heap (AGENTS.md "Concurrency").
    private val slots = Semaphore(decodeSlots)
    private val inflight = ConcurrentHashMap<UUID, CompletableFuture<Unit>>()

    fun path(photoId: UUID, rendition: Rendition): Path = cacheRoot.resolve(photoId.toString()).resolve(rendition.fileName)

    // Makes sure both renditions exist for this photo, generating them from `source` if not.
    // Concurrent callers for the same photo (the post-upload background job and a browser asking
    // for the thumbnail) share one generation rather than decoding twice.
    fun ensure(photoId: UUID, source: Path, orientation: Int) {
        if (Rendition.entries.all { Files.exists(path(photoId, it)) }) return
        val mine = CompletableFuture<Unit>()
        val running = inflight.putIfAbsent(photoId, mine)
        if (running != null) {
            running.join()
            return
        }
        try {
            generate(photoId, source, orientation)
            mine.complete(Unit)
        } catch (e: Exception) {
            mine.completeExceptionally(e)
            throw e
        } finally {
            inflight.remove(photoId)
        }
    }

    fun delete(photoId: UUID) {
        val dir = cacheRoot.resolve(photoId.toString())
        if (!Files.exists(dir)) return
        Files.walk(dir).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach(Files::delete) }
    }

    private fun generate(photoId: UUID, source: Path, orientation: Int) {
        slots.acquire()
        try {
            // Downscale before rotating: the long edge is the same either way, and rotating a
            // 2048 px image is far cheaper than rotating the full-resolution one.
            val decoded = decodeForLongEdge(source, Rendition.PREVIEW.longEdge)
            val preview = applyOrientation(downscale(toRgb(decoded), Rendition.PREVIEW.longEdge), orientation)
            val thumb = downscale(preview, Rendition.THUMB.longEdge)
            val dir = cacheRoot.resolve(photoId.toString())
            Files.createDirectories(dir)
            writeJpeg(preview, path(photoId, Rendition.PREVIEW))
            writeJpeg(thumb, path(photoId, Rendition.THUMB))
        } finally {
            slots.release()
        }
    }
}

// The stored (not oriented) pixel size, read from the file header without decoding the image.
fun probeSize(source: Path): Pair<Int, Int>? =
    ImageIO.createImageInputStream(source.toFile())?.use { input ->
        val reader = ImageIO.getImageReaders(input).asSequence().firstOrNull() ?: return null
        try {
            reader.input = input
            reader.getWidth(0) to reader.getHeight(0)
        } catch (e: Exception) {
            null
        } finally {
            reader.dispose()
        }
    }

// Decodes with source subsampling when the image is more than twice the target size. That cuts
// decode time and heap several-fold for big files. It keeps at least 2x the target resolution, so
// the smooth downscale that follows still has real detail to work from. ImageIO applies an
// embedded JPEG ICC profile here (e.g. Display P3 from phones), so the result is already sRGB.
private fun decodeForLongEdge(source: Path, longEdge: Int): BufferedImage =
    ImageIO.createImageInputStream(source.toFile()).use { input ->
        val reader = ImageIO.getImageReaders(input).asSequence().firstOrNull() ?: error("no ImageIO reader for $source")
        try {
            reader.input = input
            val factor = maxOf(1, maxOf(reader.getWidth(0), reader.getHeight(0)) / (2 * longEdge))
            val param = reader.defaultReadParam.apply { setSourceSubsampling(factor, factor, 0, 0) }
            reader.read(0, param)
        } finally {
            reader.dispose()
        }
    }

// Flattens to opaque 8-bit RGB. Transparent PNG areas become white.
private fun toRgb(image: BufferedImage): BufferedImage {
    if (image.type == BufferedImage.TYPE_INT_RGB) return image
    val out = BufferedImage(image.width, image.height, BufferedImage.TYPE_INT_RGB)
    val g = out.createGraphics()
    g.color = java.awt.Color.WHITE
    g.fillRect(0, 0, out.width, out.height)
    g.drawImage(image, 0, 0, null)
    g.dispose()
    return out
}

// Multi-step downscale (AGENTS.md "Images on the server"): halve with bilinear until within 2x of
// the target, then one bicubic step to the exact size. A single big bilinear/bicubic step aliases.
fun downscale(image: BufferedImage, longEdge: Int): BufferedImage {
    val longest = maxOf(image.width, image.height)
    if (longest <= longEdge) return image
    val scale = longEdge.toDouble() / longest
    val targetW = maxOf(1, Math.round(image.width * scale).toInt())
    val targetH = maxOf(1, Math.round(image.height * scale).toInt())
    var current = image
    while (current.width / 2 >= targetW * 2 || current.height / 2 >= targetH * 2) {
        current = resize(current, current.width / 2, current.height / 2, RenderingHints.VALUE_INTERPOLATION_BILINEAR)
    }
    return resize(current, targetW, targetH, RenderingHints.VALUE_INTERPOLATION_BICUBIC)
}

private fun resize(image: BufferedImage, w: Int, h: Int, interpolation: Any): BufferedImage {
    val out = BufferedImage(w, h, BufferedImage.TYPE_INT_RGB)
    val g = out.createGraphics()
    g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, interpolation)
    g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY)
    g.drawImage(image, 0, 0, w, h, null)
    g.dispose()
    return out
}

// Writes atomically: a temp file in the same directory, then a move (AGENTS.md).
private fun writeJpeg(image: BufferedImage, target: Path) {
    val tmp = Files.createTempFile(target.parent, ".${target.fileName}", ".tmp")
    try {
        val writer = ImageIO.getImageWritersByFormatName("jpeg").next()
        try {
            FileImageOutputStream(tmp.toFile()).use { out ->
                writer.output = out
                val param = writer.defaultWriteParam.apply {
                    compressionMode = ImageWriteParam.MODE_EXPLICIT
                    compressionQuality = JPEG_QUALITY
                }
                writer.write(null, IIOImage(image, null, null), param)
            }
        } finally {
            writer.dispose()
        }
        Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    } finally {
        Files.deleteIfExists(tmp)
    }
}
