import proof.fs.isValidPhotoFilename
import proof.fs.isValidProjectName
import proof.fs.renameDirectory
import proof.fs.resolveChild
import java.nio.file.Files
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

fun testReasonableProjectNamesAreAccepted() {
    assertTrue(isValidProjectName("Lisbon 2026"))
    assertTrue(isValidProjectName("2026-09 Family, beach & dinner"))
    assertTrue(isValidProjectName("Café"))
}

fun testUnsafeProjectNamesAreRejected() {
    for (name in listOf("", ".", "..", ".hidden", "a/b", "a\\b", "trailing.", " leading", "trailing ", "a:b", "what?", "tab\there", "x".repeat(101))) {
        assertFalse(isValidProjectName(name), "should reject \"$name\"")
    }
}

fun testPhotoFilenamesNeedASupportedExtension() {
    assertTrue(isValidPhotoFilename("IMG_0001.jpg"))
    assertTrue(isValidPhotoFilename("IMG_0001.JPEG"))
    assertTrue(isValidPhotoFilename("scan 3.png"))
    assertFalse(isValidPhotoFilename("IMG_0001.heic"))
    assertFalse(isValidPhotoFilename("noext"))
    assertFalse(isValidPhotoFilename(".jpg"))
    assertFalse(isValidPhotoFilename("../evil.jpg"))
}

fun testResolveChildStaysUnderTheParent() {
    val dir = Files.createTempDirectory("proof-project-paths-test")
    try {
        assertEquals(dir.toRealPath().resolve("Trip"), resolveChild(dir, "Trip", ::isValidProjectName))
        assertNull(resolveChild(dir, "..", ::isValidProjectName))
    } finally {
        Files.delete(dir)
    }
}

// Regression: an atomic move (rename(2)) silently replaces an *empty* target directory, which
// used to destroy an empty project when another project was renamed onto its name.
fun testRenameDirectoryNeverReplacesAnExistingEmptyDirectory() {
    val root = Files.createTempDirectory("proof-rename-test")
    try {
        val a = Files.createDirectory(root.resolve("a"))
        Files.writeString(a.resolve("photo.jpg"), "x")
        val b = Files.createDirectory(root.resolve("b")) // empty

        assertFalse(renameDirectory(a, b))
        assertTrue(Files.exists(a.resolve("photo.jpg")))
        assertTrue(Files.isDirectory(b))

        assertTrue(renameDirectory(a, root.resolve("c")))
        assertTrue(Files.exists(root.resolve("c/photo.jpg")))
    } finally {
        Files.walk(root).sorted(Comparator.reverseOrder()).forEach { Files.delete(it) }
    }
}
