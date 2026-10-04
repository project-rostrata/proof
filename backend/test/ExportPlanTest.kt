import proof.api.toApi
import proof.db.PhotoRow
import proof.db.StepCounts
import proof.export.exportEntries
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals

private fun pick(filename: String, hasEdit: Boolean = false) = PhotoRow(
    id = UUID.randomUUID(), projectId = UUID.randomUUID(), filename = filename, sizeBytes = 1, mtime = Instant.EPOCH, contentSha256 = "x",
    width = 1, height = 1, orientation = 1, captureTime = null, captureOffset = null, cameraMake = null, cameraModel = null,
    lens = null, focalLengthMm = null, fNumber = null, exposureTimeS = null, iso = null, rating = 0, flag = "pick",
    hasEdit = hasEdit, editMtime = if (hasEdit) Instant.EPOCH else null, sidecarMtime = null,
)

fun testEditedPicksExportTheirRenderAndTheRestTheirOriginal() {
    val entries = exportEntries(listOf(pick("IMG_0001.jpg", hasEdit = true), pick("IMG_0002.jpg"), pick("scan.png", hasEdit = true))) { true }
    assertEquals(listOf("IMG_0001.jpg" to true, "IMG_0002.jpg" to false, "scan.png.jpg" to true), entries.map { it.name to it.fromEdit })
}

// A render that's gone from disk falls back to the original rather than dropping the photo.
fun testAMissingRenderFallsBackToTheOriginal() {
    val entries = exportEntries(listOf(pick("IMG_0001.jpg", hasEdit = true))) { false }
    assertEquals(listOf("IMG_0001.jpg" to false), entries.map { it.name to it.fromEdit })
}

// A ZIP can't hold two entries with one name (case-insensitively, for Windows and macOS unzippers).
fun testRepeatedNamesAreMadeUnique() {
    val entries = exportEntries(listOf(pick("scan.png", hasEdit = true), pick("scan.png.jpg"), pick("SCAN.PNG.JPG"))) { true }
    assertEquals(listOf("scan.png.jpg", "scan.png (2).jpg", "SCAN.PNG (3).JPG"), entries.map { it.name })
}

fun testStepsSayHowFarTheWorkflowHasGot() {
    val empty = StepCounts(0, 0, 0, 0, 0).toApi()
    assertEquals("upload", empty.suggested)
    assertEquals(listOf("No photos yet", "Nothing to cull", "No picks yet", "No picks yet"), empty.steps.map { it.summary })
    assertEquals(listOf(false, false, false, false), empty.steps.map { it.done })

    val fresh = StepCounts(48, 0, 0, 48, 0).toApi()
    assertEquals("cull", fresh.suggested)
    assertEquals(listOf("48 photos", "48 to cull"), fresh.steps.take(2).map { it.summary })

    val partway = StepCounts(48, 30, 6, 12, 0).toApi()
    assertEquals("30 picked · 6 rejected · 12 left", partway.steps[1].summary)

    val culled = StepCounts(48, 30, 18, 0, 5).toApi()
    assertEquals("edit", culled.suggested)
    assertEquals(listOf(true, true, false, false), culled.steps.map { it.done })
    assertEquals(listOf("30 picked · 18 rejected", "5 of 30 edited", "30 photos"), culled.steps.drop(1).map { it.summary })

    assertEquals(true, StepCounts(2, 1, 1, 0, 1).toApi().steps[2].done)
}
