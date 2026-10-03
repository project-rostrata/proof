import proof.db.discoverMigrations
import proof.db.parseMigrationFilename
import java.nio.file.Files
import kotlin.test.assertEquals
import kotlin.test.assertNull

fun testParseMigrationFilenameExtractsVersionAndName() {
    val parsed = parseMigrationFilename("0001_initial_schema.sql")

    assertEquals(1 to "initial_schema", parsed)
}

fun testParseMigrationFilenameRejectsNonMatchingNames() {
    assertNull(parseMigrationFilename("readme.md"))
    assertNull(parseMigrationFilename("initial_schema.sql"))
    assertNull(parseMigrationFilename("0001_initial_schema.txt"))
}

fun testDiscoverMigrationsSortsByVersionAndSkipsUnmatchedFiles() {
    val dir = Files.createTempDirectory("proof-migrations-test")
    try {
        Files.writeString(dir.resolve("0002_add_widgets.sql"), "-- noop")
        Files.writeString(dir.resolve("0001_initial_schema.sql"), "-- noop")
        Files.writeString(dir.resolve("README.md"), "not a migration")

        val migrations = discoverMigrations(dir)

        assertEquals(listOf(1, 2), migrations.map { it.version })
        assertEquals(listOf("initial_schema", "add_widgets"), migrations.map { it.name })
    } finally {
        Files.walk(dir).sorted(Comparator.reverseOrder()).forEach { Files.delete(it) }
    }
}
