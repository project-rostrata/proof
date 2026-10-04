package proof.db

import java.sql.PreparedStatement
import java.sql.ResultSet
import java.sql.Timestamp
import java.sql.Types
import java.util.UUID

private const val PHOTO_COLUMNS = """
    ph.id, ph.project_id, ph.filename, ph.size_bytes, ph.mtime, ph.content_sha256, ph.width, ph.height,
    ph.orientation, ph.capture_time, ph.capture_offset, ph.camera_make, ph.camera_model, ph.lens,
    ph.focal_length_mm, ph.f_number, ph.exposure_time_s, ph.iso, ph.rating, ph.flag,
    ph.has_edit, ph.edit_mtime, ph.sidecar_mtime
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

    // One cull view of a project (PROJECT_BRIEF.md §6), filtered in SQL (the UI never filters), in
    // capture order, which is the natural order to cull in. Photos without EXIF go last, by name.
    fun listForProject(projectId: UUID, view: CullView, minRating: Int): List<PhotoRow> =
        database.queryList(
            "SELECT $PHOTO_COLUMNS FROM photos ph WHERE ph.project_id = ? AND ${view.where} AND ph.rating >= ? " +
                "ORDER BY ph.capture_time NULLS LAST, ph.filename",
            bind = { stmt ->
                stmt.setObject(1, projectId)
                stmt.setInt(2, minRating)
            },
            mapRow = ::toRow,
        )

    // How far the project's workflow has got (api/Steps.kt): undecided means neither picked nor
    // rejected, whatever the stars.
    fun stepCounts(projectId: UUID): StepCounts =
        database.queryOne(
            """
            SELECT count(*) AS total,
                   count(*) FILTER (WHERE ph.flag = 'pick') AS picked,
                   count(*) FILTER (WHERE ph.flag = 'reject') AS rejected,
                   count(*) FILTER (WHERE ph.flag = 'none') AS undecided,
                   count(*) FILTER (WHERE ph.flag = 'pick' AND ph.has_edit) AS edited_picks
            FROM photos ph WHERE ph.project_id = ?
            """.trimIndent(),
            bind = { it.setObject(1, projectId) },
            mapRow = { rs -> StepCounts(rs.getInt("total"), rs.getInt("picked"), rs.getInt("rejected"), rs.getInt("undecided"), rs.getInt("edited_picks")) },
        )

    fun viewCounts(projectId: UUID): Map<CullView, Int> {
        val counts = database.queryOne(
            "SELECT " + CullView.entries.joinToString(", ") { "count(*) FILTER (WHERE ${it.where}) AS ${it.name}" } +
                " FROM photos ph WHERE ph.project_id = ?",
            bind = { it.setObject(1, projectId) },
            mapRow = { rs -> CullView.entries.associateWith { rs.getInt(it.name) } },
        )
        return counts
    }

    // The cull state as the sidecar now holds it, and that sidecar's mtime (null: there's no sidecar).
    fun updateCull(id: UUID, rating: Int, flag: String, sidecarMtime: java.time.Instant?) {
        database.update(
            "UPDATE photos SET rating = ?, flag = ?, sidecar_mtime = ? WHERE id = ?",
            bind = { stmt ->
                stmt.setInt(1, rating)
                stmt.setString(2, flag)
                stmt.setTimestamp(3, sidecarMtime?.let(Timestamp::from))
                stmt.setObject(4, id)
            },
        )
    }

    // recipeVersion is null when a recipe found on disk can't be read (reconciliation).
    fun updateEdit(id: UUID, editMtime: java.time.Instant, recipeVersion: Int?) {
        database.update(
            "UPDATE photos SET has_edit = true, edit_mtime = ?, recipe_version = ? WHERE id = ?",
            bind = { stmt ->
                stmt.setTimestamp(1, Timestamp.from(editMtime))
                stmt.setObject(2, recipeVersion, Types.INTEGER)
                stmt.setObject(3, id)
            },
        )
    }

    // The original was replaced on disk (reconciliation): everything read from the file is re-read.
    fun updateOriginal(id: UUID, photo: NewPhoto) {
        database.update(
            """
            UPDATE photos SET size_bytes = ?, mtime = ?, content_sha256 = ?, width = ?, height = ?, orientation = ?,
                capture_time = ?, capture_offset = ?, camera_make = ?, camera_model = ?, lens = ?,
                focal_length_mm = ?, f_number = ?, exposure_time_s = ?, iso = ?
            WHERE id = ?
            """.trimIndent(),
            bind = { stmt ->
                stmt.setLong(1, photo.sizeBytes)
                stmt.setTimestamp(2, Timestamp.from(photo.mtime))
                stmt.setString(3, photo.contentSha256)
                stmt.setInt(4, photo.width)
                stmt.setInt(5, photo.height)
                stmt.setInt(6, photo.orientation)
                stmt.setObject(7, photo.captureTime, Types.TIMESTAMP)
                stmt.setString(8, photo.captureOffset)
                stmt.setString(9, photo.cameraMake)
                stmt.setString(10, photo.cameraModel)
                stmt.setString(11, photo.lens)
                stmt.setNullableDouble(12, photo.focalLengthMm)
                stmt.setNullableDouble(13, photo.fNumber)
                stmt.setNullableDouble(14, photo.exposureTimeS)
                stmt.setObject(15, photo.iso, Types.INTEGER)
                stmt.setObject(16, id)
            },
        )
    }

    fun delete(id: UUID) {
        database.update("DELETE FROM photos WHERE id = ?", bind = { it.setObject(1, id) })
    }

    // Every photo in a project, unfiltered, for reconciliation.
    fun listAll(projectId: UUID): List<PhotoRow> =
        database.queryList("SELECT $PHOTO_COLUMNS FROM photos ph WHERE ph.project_id = ?", bind = { it.setObject(1, projectId) }, mapRow = ::toRow)

    fun clearEdit(id: UUID) {
        database.update("UPDATE photos SET has_edit = false, edit_mtime = NULL, recipe_version = NULL WHERE id = ?", bind = { it.setObject(1, id) })
    }

    fun filenamesInProject(projectId: UUID): List<String> =
        database.queryList("SELECT filename FROM photos WHERE project_id = ?", bind = { it.setObject(1, projectId) }, mapRow = { it.getString("filename") })

    fun idsForProject(projectId: UUID): List<UUID> =
        database.queryList(
            "SELECT id FROM photos WHERE project_id = ?",
            bind = { it.setObject(1, projectId) },
            mapRow = { it.getObject("id", UUID::class.java) },
        )

    fun findById(id: UUID): PhotoRow? =
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
        hasEdit = rs.getBoolean("has_edit"),
        editMtime = rs.getTimestamp("edit_mtime")?.toInstant(),
        sidecarMtime = rs.getTimestamp("sidecar_mtime")?.toInstant(),
    )
}

private fun PreparedStatement.setNullableDouble(index: Int, value: Double?) {
    if (value == null) setNull(index, Types.DOUBLE) else setDouble(index, value)
}
