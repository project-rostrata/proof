package proof.db

import java.nio.file.Files
import java.nio.file.Path
import java.sql.Connection
import java.util.logging.Logger

// Copied from shelf: plain numbered .sql files in db/migrations/, each applied once, in order, inside
// a transaction, and recorded in schema_migrations. Migrations are append-only -- never edit one that
// has been applied anywhere; add a new one.
data class Migration(val version: Int, val name: String, val path: Path)

private val MIGRATION_FILENAME = Regex("""(\d+)_(.+)\.sql""")

fun parseMigrationFilename(filename: String): Pair<Int, String>? {
    val match = MIGRATION_FILENAME.matchEntire(filename) ?: return null
    return match.groupValues[1].toInt() to match.groupValues[2]
}

fun discoverMigrations(dir: Path): List<Migration> =
    Files.list(dir).use { it.toList() }
        .mapNotNull { path ->
            val (version, name) = parseMigrationFilename(path.fileName.toString()) ?: return@mapNotNull null
            Migration(version, name, path)
        }
        .sortedBy { it.version }

class MigrationRunner(private val connection: Connection, private val migrationsDir: Path) {
    private val logger = Logger.getLogger(MigrationRunner::class.qualifiedName)

    fun run() {
        ensureMigrationsTable()
        val applied = appliedVersions()
        val pending = discoverMigrations(migrationsDir).filter { it.version !in applied }
        for (migration in pending) {
            apply(migration)
        }
    }

    private fun ensureMigrationsTable() {
        connection.createStatement().use {
            it.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """.trimIndent()
            )
        }
    }

    private fun appliedVersions(): Set<Int> {
        connection.createStatement().use { statement ->
            statement.executeQuery("SELECT version FROM schema_migrations").use { resultSet ->
                val versions = mutableSetOf<Int>()
                while (resultSet.next()) versions += resultSet.getInt(1)
                return versions
            }
        }
    }

    private fun apply(migration: Migration) {
        logger.info("applying migration ${migration.version}: ${migration.name}")
        connection.autoCommit = false
        try {
            connection.createStatement().use { it.execute(Files.readString(migration.path)) }
            connection.prepareStatement("INSERT INTO schema_migrations (version) VALUES (?)").use {
                it.setInt(1, migration.version)
                it.execute()
            }
            connection.commit()
        } catch (e: Exception) {
            connection.rollback()
            throw e
        } finally {
            connection.autoCommit = true
        }
    }
}
