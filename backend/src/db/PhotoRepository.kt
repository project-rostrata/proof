package proof.db

import java.sql.PreparedStatement
import java.sql.ResultSet
import java.sql.Timestamp
import java.sql.Types
import java.util.UUID

private const val PHOTO_COLUMNS = """
    ph.id, ph.project_id, ph.filename, ph.size_bytes, ph.mtime, ph.content_sha256, ph.width, ph.height,
    ph.orientation, ph.capture_time, ph.capture_offset, ph.camera_make, ph.camera_model, ph.lens,
    ph.focal_length_mm, ph.f_number, ph.exposure_time_s, ph.iso, ph.rating, ph.flag, ph.label,
    ph.has_edit, ph.edit_mtime
"""

class PhotoRepository(private val database: Database) {
    fun insert(photo: NewPhoto): PhotoRow {
        val id = UUID.randomUUID()
        database.update(
            """
            INSERT INTO photos (id, project_id, filename, size_bytes, mtime, content_sha256, width, height,
                orientation, capture_time, capture_offset, camera_make, camera_model, lens,
                focal_length_mm, f_number, exposure_time_s, iso)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            bind = { stmt ->
                stmt.setObject(1, id)
                stmt.setObject(2, photo.projectId)
                stmt.setString(3, photo.filename)
                stmt.setLong(4, photo.sizeBytes)
                stmt.setTimestamp(5, Timestamp.from(photo.mtime))
                stmt.setString(6, photo.contentSha256)
                stmt.setInt(7, photo.width)
                stmt.setInt(8, photo.height)
                stmt.setInt(9, photo.orientation)
                stmt.setObject(10, photo.captureTime, Types.TIMESTAMP)
                stmt.setString(11, photo.captureOffset)
                stmt.setString(12, photo.cameraMake)
                stmt.setString(13, photo.cameraModel)
                stmt.setString(14, photo.lens)
                stmt.setNullableDouble(15, photo.focalLengthMm)
                stmt.setNullableDouble(16, photo.fNumber)
                stmt.setNullableDouble(17, photo.exposureTimeS)
                stmt.setObject(18, photo.iso, Types.INTEGER)
            },
        )
        return findById(id) ?: error("just-inserted photo $id not found")
    }

    fun findByFilename(projectId: UUID, filename: String): PhotoRow? =
        database.queryOneOrNull(
            "SELECT $PHOTO_COLUMNS FROM photos ph WHERE ph.project_id = ? AND ph.filename = ?",
            bind = { stmt ->
                stmt.setObject(1, projectId)
                stmt.setString(2, filename)
            },
            mapRow = ::toRow,
        )

    // Ownership is checked through the project, so another user's photo id behaves as missing.
    fun findOwned(id: UUID, ownerId: UUID): OwnedPhotoRow? =
        database.queryOneOrNull(
            "SELECT $PHOTO_COLUMNS, p.name AS project_name FROM photos ph JOIN projects p ON p.id = ph.project_id WHERE ph.id = ? AND p.owner_id = ?",
            bind = { stmt ->
                stmt.setObject(1, id)
                stmt.setObject(2, ownerId)
            },
            mapRow = { rs -> OwnedPhotoRow(toRow(rs), rs.getString("project_name")) },
        )

    // Capture order, which is the natural order to cull in. Photos without EXIF go last, by name.
    fun listForProject(projectId: UUID): List<PhotoRow> =
        database.queryList(
            "SELECT $PHOTO_COLUMNS FROM photos ph WHERE ph.project_id = ? ORDER BY ph.capture_time NULLS LAST, ph.filename",
            bind = { it.setObject(1, projectId) },
            mapRow = ::toRow,
        )

    fun idsForProject(projectId: UUID): List<UUID> =
        database.queryList(
            "SELECT id FROM photos WHERE project_id = ?",
            bind = { it.setObject(1, projectId) },
            mapRow = { it.getObject("id", UUID::class.java) },
        )

    private fun findById(id: UUID): PhotoRow? =
        database.queryOneOrNull(
            "SELECT $PHOTO_COLUMNS FROM photos ph WHERE ph.id = ?",
            bind = { it.setObject(1, id) },
            mapRow = ::toRow,
        )

    private fun toRow(rs: ResultSet): PhotoRow = PhotoRow(
        id = rs.getObject("id", UUID::class.java),
        projectId = rs.getObject("project_id", UUID::class.java),
        filename = rs.getString("filename"),
        sizeBytes = rs.getLong("size_bytes"),
        mtime = rs.getTimestamp("mtime").toInstant(),
        contentSha256 = rs.getString("content_sha256"),
        width = rs.getInt("width"),
        height = rs.getInt("height"),
        orientation = rs.getInt("orientation"),
        captureTime = rs.getObject("capture_time", java.time.LocalDateTime::class.java),
        captureOffset = rs.getString("capture_offset"),
        cameraMake = rs.getString("camera_make"),
        cameraModel = rs.getString("camera_model"),
        lens = rs.getString("lens"),
        focalLengthMm = rs.getDouble("focal_length_mm").takeUnless { rs.wasNull() },
        fNumber = rs.getDouble("f_number").takeUnless { rs.wasNull() },
        exposureTimeS = rs.getDouble("exposure_time_s").takeUnless { rs.wasNull() },
        iso = rs.getInt("iso").takeUnless { rs.wasNull() },
        rating = rs.getInt("rating"),
        flag = rs.getString("flag"),
        label = rs.getString("label"),
        hasEdit = rs.getBoolean("has_edit"),
        editMtime = rs.getTimestamp("edit_mtime")?.toInstant(),
    )
}

private fun PreparedStatement.setNullableDouble(index: Int, value: Double?) {
    if (value == null) setNull(index, Types.DOUBLE) else setDouble(index, value)
}
