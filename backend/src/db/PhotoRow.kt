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
)

// What ingest knows about a new photo. Cull and edit state start at their column defaults.
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
