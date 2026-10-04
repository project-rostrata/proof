package proof.db

import java.time.Instant
import java.time.LocalDateTime
import java.util.UUID

data class PhotoRow(
    val id: UUID,
    val projectId: UUID,
    val filename: String,
    val sizeBytes: Long,
    val mtime: Instant,
    val contentSha256: String,
    val width: Int,
    val height: Int,
    val orientation: Int,
    val captureTime: LocalDateTime?,
    val captureOffset: String?,
    val cameraMake: String?,
    val cameraModel: String?,
    val lens: String?,
    val focalLengthMm: Double?,
    val fNumber: Double?,
    val exposureTimeS: Double?,
    val iso: Int?,
    val rating: Int,
    val flag: String,
    val hasEdit: Boolean,
    val editMtime: Instant?,
    val sidecarMtime: Instant?, // the XMP sidecar as last read or written; null if none has been seen
)

// What's read from an original itself: everything the index records about the file, for a new
// photo (upload or reconciliation) or one whose original changed on disk. Cull and edit state come
// from elsewhere (the sidecar and edits/), and start at their column defaults.
data class NewPhoto(
    val projectId: UUID,
    val filename: String,
    val sizeBytes: Long,
    val mtime: Instant,
    val contentSha256: String,
    val width: Int,
    val height: Int,
    val orientation: Int,
    val captureTime: LocalDateTime?,
    val captureOffset: String?,
    val cameraMake: String?,
    val cameraModel: String?,
    val lens: String?,
    val focalLengthMm: Double?,
    val fNumber: Double?,
    val exposureTimeS: Double?,
    val iso: Int?,
)

// A photo plus the project directory name needed to find its files on disk.
data class OwnedPhotoRow(val photo: PhotoRow, val projectName: String)

// Where a project's workflow stands (PhotoRepository.stepCounts).
data class StepCounts(val total: Int, val picked: Int, val rejected: Int, val undecided: Int, val editedPicks: Int)
