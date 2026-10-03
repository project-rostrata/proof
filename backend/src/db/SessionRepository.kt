package proof.db

import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

private const val SESSION_COLUMNS = "id, user_id, created_at, expires_at"

class SessionRepository(private val database: Database) {
    fun create(userId: UUID, expiresAt: Instant): SessionRow {
        val id = UUID.randomUUID()
        database.update(
            "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
            bind = { stmt ->
                stmt.setObject(1, id)
                stmt.setObject(2, userId)
                stmt.setTimestamp(3, Timestamp.from(expiresAt))
            },
        )
        return findById(id) ?: error("just-inserted session $id not found")
    }

    // Expiry is checked in SQL (against the database's own clock), not in Kotlin —
    // avoids any app/DB clock-skew argument about what "now" means.
    fun findValid(id: UUID): SessionRow? =
        database.queryOneOrNull(
            "SELECT $SESSION_COLUMNS FROM sessions WHERE id = ? AND expires_at > now()",
            bind = { it.setObject(1, id) },
            mapRow = ::toRow,
        )

    fun delete(id: UUID) {
        database.update("DELETE FROM sessions WHERE id = ?", bind = { it.setObject(1, id) })
    }

    private fun findById(id: UUID): SessionRow? =
        database.queryOneOrNull(
            "SELECT $SESSION_COLUMNS FROM sessions WHERE id = ?",
            bind = { it.setObject(1, id) },
            mapRow = ::toRow,
        )

    private fun toRow(rs: ResultSet): SessionRow = SessionRow(
        id = rs.getObject("id", UUID::class.java),
        userId = rs.getObject("user_id", UUID::class.java),
        createdAt = rs.getTimestamp("created_at").toInstant(),
        expiresAt = rs.getTimestamp("expires_at").toInstant(),
    )
}
