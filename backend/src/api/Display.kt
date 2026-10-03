package proof.api

import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt
import kotlin.math.roundToLong

// Every human-readable string the UI shows is built here (AGENTS.md: the API is the source of
// truth and the UI stays dumb). Formatting is fixed to English for v1.

private val CAPTURE_FORMAT = DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm", Locale.ENGLISH)

fun captureDisplay(time: LocalDateTime?): String? = time?.format(CAPTURE_FORMAT)

fun photoCountDisplay(count: Int): String = if (count == 1) "1 photo" else "$count photos"

fun fileSizeDisplay(bytes: Long): String = when {
    bytes >= 1_000_000_000 -> "%.1f GB".format(Locale.ENGLISH, bytes / 1e9)
    bytes >= 1_000_000 -> "%.1f MB".format(Locale.ENGLISH, bytes / 1e6)
    bytes >= 1_000 -> "${(bytes / 1e3).roundToInt()} KB"
    else -> "$bytes B"
}

fun dimensionsDisplay(width: Int, height: Int): String {
    val megapixels = width.toLong() * height / 1e6
    return "$width × $height · ${"%.1f".format(Locale.ENGLISH, megapixels)} MP"
}

// "Olympus E-PL7", "Google Pixel 7a", "Canon EOS R6". Cameras write Make inconsistently
// ("OLYMPUS IMAGING CORP.", "Canon", "NIKON CORPORATION"), and Model often repeats the brand
// already. So: the brand is Make's first word, title-cased if it's shouted, and it's only
// prefixed when Model doesn't already contain it.
fun cameraDisplay(make: String?, model: String?): String? {
    val brand = make?.trim()?.split(Regex("\\s+"))?.firstOrNull()?.ifEmpty { null }
        ?.let { if (it == it.uppercase() && it.length > 3) it.lowercase().replaceFirstChar(Char::titlecase) else it }
    val cleanModel = model?.trim()?.ifEmpty { null }
    return when {
        cleanModel == null -> brand
        brand == null || cleanModel.contains(brand, ignoreCase = true) -> cleanModel
        else -> "$brand $cleanModel"
    }
}

// "23 mm · f/2 · 1/250 s · ISO 400". Missing parts are skipped. Null if nothing is known.
fun exposureDisplay(focalLengthMm: Double?, fNumber: Double?, exposureTimeS: Double?, iso: Int?): String? {
    val parts = listOfNotNull(
        focalLengthMm?.let { "${trimNumber(it, if (it < 10) 1 else 0)} mm" }, // phone lenses are a few mm: keep a decimal
        fNumber?.let { "f/${trimNumber(it, 1)}" },
        exposureTimeS?.let(::shutterDisplay),
        iso?.let { "ISO $it" },
    )
    return parts.joinToString(" · ").ifEmpty { null }
}

// Sub-second exposures are shown as the conventional 1/N; longer ones in seconds.
fun shutterDisplay(seconds: Double): String =
    if (seconds < 1.0) "1/${(1.0 / seconds).roundToLong()} s" else "${trimNumber(seconds, 1)} s"

private fun trimNumber(value: Double, decimals: Int): String {
    val text = "%.${decimals}f".format(Locale.ENGLISH, value)
    return if (text.contains('.')) text.trimEnd('0').trimEnd('.') else text
}
