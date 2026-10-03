import proof.fs.isValidUsername
import proof.fs.userRoot
import java.nio.file.Path
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

fun testUserRootIsTheUsernameDirectoryUnderTheDataRoot() {
    assertEquals(Path.of("/data/alice"), userRoot(Path.of("/data"), "alice"))
}

fun testValidUsernamesAreAccepted() {
    assertTrue(isValidUsername("alice"))
    assertTrue(isValidUsername("alice123"))
    assertTrue(isValidUsername("alice.doe"))
    assertTrue(isValidUsername("alice_doe"))
    assertTrue(isValidUsername("alice-doe"))
    assertTrue(isValidUsername("A"))
}

fun testBlankUsernameIsRejected() {
    assertFalse(isValidUsername(""))
}

// A username becomes a real path segment, unescaped, so anything that could traverse must be
// rejected before RegisterHandler creates the directory.
fun testPathTraversalShapedUsernamesAreRejected() {
    assertFalse(isValidUsername(".."))
    assertFalse(isValidUsername("."))
    assertFalse(isValidUsername("../../etc"))
    assertFalse(isValidUsername("foo/bar"))
    assertFalse(isValidUsername("/etc/passwd"))
}

// proof keeps its own state in leading-dot directories under $PROOF_DATA (.cache/), so no user may
// take a leading-dot name. This is the one rule proof adds to shelf's.
fun testLeadingDotUsernamesAreRejected() {
    assertFalse(isValidUsername(".cache"))
    assertFalse(isValidUsername(".alice"))
}

fun testUsernamesWithDisallowedCharactersAreRejected() {
    assertFalse(isValidUsername("alice smith"))
    assertFalse(isValidUsername("alice@doe.com"))
    assertFalse(isValidUsername("alice\u0000"))
}

fun testOverlongUsernameIsRejected() {
    assertFalse(isValidUsername("a".repeat(65)))
    assertTrue(isValidUsername("a".repeat(64)))
}
