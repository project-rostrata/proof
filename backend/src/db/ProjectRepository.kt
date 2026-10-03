package proof.db

import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

private const val PROJECT_COLUMNS = "p.id, p.owner_id, p.name, p.created_at, p.updated_at"

class ProjectRepository(private val database: Database) {
    fun create(ownerId: UUID, name: String): ProjectRow {
        val id = UUID.randomUUID()
        database.update(
            "INSERT INTO projects (id, owner_id, name) VALUES (?, ?, ?)",
            bind = { stmt ->
                stmt.setObject(1, id)
                stmt.setObject(2, ownerId)
                stmt.setString(3, name)
            },
        )
        return findOwned(id, ownerId) ?: error("just-inserted project $id not found")
    }

    // Ownership is part of every lookup: another user's project is indistinguishable from a
    // missing one (404, not 403), so ids can't be probed.
    fun findOwned(id: UUID, ownerId: UUID): ProjectRow? =
        database.queryOneOrNull(
            "SELECT $PROJECT_COLUMNS FROM projects p WHERE p.id = ? AND p.owner_id = ?",
            bind = { stmt ->
                stmt.setObject(1, id)
                stmt.setObject(2, ownerId)
            },
            mapRow = ::toRow,
        )

    // Newest first. The cover is the project's earliest-captured photo.
    fun listSummaries(ownerId: UUID): List<ProjectSummaryRow> =
        database.queryList(
            """
            SELECT $PROJECT_COLUMNS,
                   (SELECT count(*) FROM photos ph WHERE ph.project_id = p.id) AS photo_count,
                   cover.id AS cover_id, cover.version AS cover_version
            FROM projects p
            LEFT JOIN LATERAL (
                SELECT ph.id, coalesce(ph.edit_mtime, ph.mtime) AS version FROM photos ph
                WHERE ph.project_id = p.id
                ORDER BY ph.capture_time NULLS LAST, ph.filename
                LIMIT 1
            ) cover ON true
            WHERE p.owner_id = ?
            ORDER BY p.created_at DESC
            """.trimIndent(),
            bind = { it.setObject(1, ownerId) },
            mapRow = { rs ->
                ProjectSummaryRow(
                    project = toRow(rs),
                    photoCount = rs.getInt("photo_count"),
                    coverPhotoId = rs.getObject("cover_id", UUID::class.java),
                    coverVersion = rs.getTimestamp("cover_version")?.toInstant(),
                )
            },
        )

    fun rename(id: UUID, name: String) {
        database.update(
            "UPDATE projects SET name = ?, updated_at = now() WHERE id = ?",
            bind = { stmt ->
                stmt.setString(1, name)
                stmt.setObject(2, id)
            },
        )
    }

    fun touch(id: UUID, at: Instant = Instant.now()) {
        database.update(
            "UPDATE projects SET updated_at = ? WHERE id = ?",
            bind = { stmt ->
                stmt.setTimestamp(1, Timestamp.from(at))
                stmt.setObject(2, id)
            },
        )
    }

    // Photos go with it (ON DELETE CASCADE).
    fun delete(id: UUID) {
        database.update("DELETE FROM projects WHERE id = ?", bind = { it.setObject(1, id) })
    }

    private fun toRow(rs: ResultSet): ProjectRow = ProjectRow(
        id = rs.getObject("id", UUID::class.java),
        ownerId = rs.getObject("owner_id", UUID::class.java),
        name = rs.getString("name"),
        createdAt = rs.getTimestamp("created_at").toInstant(),
        updatedAt = rs.getTimestamp("updated_at").toInstant(),
    )
}
