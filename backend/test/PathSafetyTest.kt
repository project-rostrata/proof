import proof.fs.Rejected
import proof.fs.Resolved
import proof.fs.resolveUnderRoot
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.assertEquals
import kotlin.test.assertIs

private fun withTempRoot(block: (Path) -> Unit) {
    val root = Files.createTempDirectory("proof-path-safety-test")
    try {
        block(root)
    } finally {
        Files.walk(root).sorted(Comparator.reverseOrder()).forEach { Files.delete(it) }
    }
}

fun testResolvesExistingNestedPath() = withTempRoot { root ->
    Files.createDirectories(root.resolve("docs"))
    Files.writeString(root.resolve("docs/readme.txt"), "hi")

    val result = resolveUnderRoot(root, "docs/readme.txt")

    assertIs<Resolved>(result)
    assertEquals(root.toRealPath().resolve("docs/readme.txt"), result.path)
}

fun testRejectsDotDotTraversal() = withTempRoot { root ->
    val result = resolveUnderRoot(root, "../../etc/passwd")

    assertIs<Rejected>(result)
}

fun testTreatsLeadingSlashAsRelative() = withTempRoot { root ->
    Files.writeString(root.resolve("secret.txt"), "not actually filesystem-root /secret.txt")

    val result = resolveUnderRoot(root, "/secret.txt")

    assertIs<Resolved>(result)
    assertEquals(root.toRealPath().resolve("secret.txt"), result.path)
}

fun testResolvesNonExistentTargetWithExistingParent() = withTempRoot { root ->
    Files.createDirectories(root.resolve("uploads"))

    val result = resolveUnderRoot(root, "uploads/new-file.bin")

    assertIs<Resolved>(result)
    assertEquals(root.toRealPath().resolve("uploads/new-file.bin"), result.path)
}

fun testRejectsSymlinkEscapingRoot() = withTempRoot { root ->
    val outside = Files.createTempDirectory("proof-path-safety-outside")
    try {
        Files.writeString(outside.resolve("real-secret.txt"), "outside root")
        Files.createSymbolicLink(root.resolve("escape"), outside)

        val result = resolveUnderRoot(root, "escape/real-secret.txt")

        assertIs<Rejected>(result)
    } finally {
        Files.walk(outside).sorted(Comparator.reverseOrder()).forEach { Files.delete(it) }
    }
}

fun testEmptyRequestResolvesToRootItself() = withTempRoot { root ->
    val result = resolveUnderRoot(root, "")

    assertIs<Resolved>(result)
    assertEquals(root.toRealPath(), result.path)
}

fun testRejectsNonExistentRoot() {
    val fake = Path.of("/nonexistent/proof-path-safety-does-not-exist")

    val result = resolveUnderRoot(fake, "anything")

    assertIs<Rejected>(result)
}
