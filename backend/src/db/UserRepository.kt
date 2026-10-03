package proof.db

import java.sql.ResultSet
import java.util.UUID

private const val USER_COLUMNS = "id, username, password_hash, created_at"

// Adapted from shelf's UserRepository, without the email/is_admin/quota columns proof doesn't have.
class UserRepository(private val database: Database) {
    fun create(username: String, passwordHash: String): UserRow {
        val id = UUID.randomUUID()
        database.update(
            "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
            bind = { stmt ->
                stmt.setObject(1, id)
                stmt.setString(2, username)
                stmt.setString(3, passwordHash)
            },
        )
        return findById(id) ?: error("just-inserted user $id not found")
    }

    fun findByUsername(username: String): UserRow? =
        database.queryOneOrNull(
            "SELECT $USER_COLUMNS FROM users WHERE username = ?",
            bind = { it.setString(1, username) },
            mapRow = ::toRow,
        )

    fun exists(): Boolean = database.queryOne("SELECT EXISTS (SELECT 1 FROM users) AS any", mapRow = { it.getBoolean("any") })

    fun listAll(): List<UserRow> = database.queryList("SELECT $USER_COLUMNS FROM users ORDER BY username", mapRow = ::toRow)

    fun findById(id: UUID): UserRow? =
        database.queryOneOrNull(
            "SELECT $USER_COLUMNS FROM users WHERE id = ?",
            bind = { it.setObject(1, id) },
            mapRow = ::toRow,
        )

    private fun toRow(rs: ResultSet): UserRow = UserRow(
        id = rs.getObject("id", UUID::class.java),
        username = rs.getString("username"),
        passwordHash = rs.getString("password_hash"),
        createdAt = rs.getTimestamp("created_at").toInstant(),
    )
}
