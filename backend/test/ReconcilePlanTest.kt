import proof.db.PhotoRow
import proof.db.ProjectRow
import proof.fs.fileMtime
import proof.fs.truncateToIndex
import proof.index.DiskPhoto
import proof.index.planPhotos
import proof.index.planProjects
import java.nio.file.Files
import java.nio.file.attribute.FileTime
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private val T0 = Instant.parse("2026-10-01T10:00:00.123456Z")
private val T1 = Instant.parse("2026-10-02T11:00:00.654321Z")
private val PROJECT = UUID.randomUUID()

private fun row(
    filename: String,
    size: Long = 100,
    mtime: Instant = T0,
    sidecarMtime: Instant? = null,
    editMtime: Instant? = null,
) = PhotoRow(
    id = UUID.randomUUID(), projectId = PROJECT, filename = filename, sizeBytes = size, mtime = mtime, contentSha256 = "x",
    width = 1, height = 1, orientation = 1, captureTime = null, captureOffset = null, cameraMake = null, cameraModel = null,
    lens = null, focalLengthMm = null, fNumber = null, exposureTimeS = null, iso = null, rating = 0, flag = "none",
    hasEdit = editMtime != null, editMtime = editMtime, sidecarMtime = sidecarMtime,
)

private fun disk(filename: String, size: Long = 100, mtime: Instant = T0, sidecarMtime: Instant? = null, editMtime: Instant? = null) =
    DiskPhoto(filename, size, mtime, sidecarMtime, editMtime)

fun testAnUnchangedProjectNeedsNothing() {
    val changes = planPhotos(
        listOf(disk("a.jpg", sidecarMtime = T1, editMtime = T1), disk("b.png")),
        listOf(row("a.jpg", sidecarMtime = T1, editMtime = T1), row("b.png")),
    )
    assertTrue(changes.isEmpty)
}

fun testNewAndVanishedOriginalsAreAddedAndRemoved() {
    val gone = row("gone.jpg")
    val changes = planPhotos(listOf(disk("kept.jpg"), disk("new.jpg")), listOf(row("kept.jpg"), gone))
    assertEquals(listOf("new.jpg"), changes.added.map { it.filename })
    assertEquals(listOf(gone), changes.removed)
    assertTrue(changes.originalChanged.isEmpty() && changes.sidecarChanged.isEmpty() && changes.editChanged.isEmpty())
}

fun testAnOriginalReplacedInPlaceIsReRead() {
    val sameSizeNewTime = planPhotos(listOf(disk("a.jpg", mtime = T1)), listOf(row("a.jpg")))
    assertEquals(1, sameSizeNewTime.originalChanged.size)
    val sameTimeNewSize = planPhotos(listOf(disk("a.jpg", size = 101)), listOf(row("a.jpg")))
    assertEquals(1, sameTimeNewSize.originalChanged.size)
}

// A sidecar written, created, or deleted outside the app (darktable, Lightroom) is re-read.
fun testSidecarChangesAreNoticedInEveryDirection() {
    assertEquals(1, planPhotos(listOf(disk("a.jpg", sidecarMtime = T0)), listOf(row("a.jpg"))).sidecarChanged.size) // appeared
    assertEquals(1, planPhotos(listOf(disk("a.jpg", sidecarMtime = T1)), listOf(row("a.jpg", sidecarMtime = T0))).sidecarChanged.size) // rewritten
    assertEquals(1, planPhotos(listOf(disk("a.jpg")), listOf(row("a.jpg", sidecarMtime = T0))).sidecarChanged.size) // deleted
}

fun testEditChangesAreNoticedInEveryDirection() {
    assertEquals(1, planPhotos(listOf(disk("a.jpg", editMtime = T0)), listOf(row("a.jpg"))).editChanged.size) // appeared
    assertEquals(1, planPhotos(listOf(disk("a.jpg", editMtime = T1)), listOf(row("a.jpg", editMtime = T0))).editChanged.size) // replaced
    assertEquals(1, planPhotos(listOf(disk("a.jpg")), listOf(row("a.jpg", editMtime = T0))).editChanged.size) // deleted
}

// Postgres keeps microseconds and Linux file times have nanoseconds. Without truncating, every file
// would look changed on every pass and be re-hashed.
fun testFileTimesAreTruncatedToTheIndexPrecision() {
    val dir = Files.createTempDirectory("proof-mtime-test")
    try {
        val file = Files.writeString(dir.resolve("a.jpg"), "x")
        Files.setLastModifiedTime(file, FileTime.from(Instant.parse("2026-10-01T10:00:00.123456789Z")))
        assertEquals(Instant.parse("2026-10-01T10:00:00.123456Z"), fileMtime(file))
        assertEquals(fileMtime(file), truncateToIndex(fileMtime(file)))
    } finally {
        Files.walk(dir).sorted(Comparator.reverseOrder()).forEach { Files.delete(it) }
    }
}

// A folder renamed outside the app is one project removed and one added; the photos' cull state
// and edits survive in the sidecars and edits/.
fun testProjectFoldersAreComparedByName() {
    val owner = UUID.randomUUID()
    val project = { name: String -> ProjectRow(UUID.randomUUID(), owner, name, T0, T0) }
    val kept = project("Kept")
    val renamed = project("Old name")
    val changes = planProjects(setOf("Kept", "New name", "Another"), listOf(kept, renamed))
    assertEquals(listOf("Another", "New name"), changes.added)
    assertEquals(listOf(renamed), changes.removed)
}
