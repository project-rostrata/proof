import proof.auth.PasswordHasher
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

fun testHashVerifiesAgainstItsOwnPassword() {
    val hash = PasswordHasher.hash("correct horse battery staple".toCharArray())

    assertTrue(PasswordHasher.verify("correct horse battery staple".toCharArray(), hash))
}

fun testVerifyFailsForWrongPassword() {
    val hash = PasswordHasher.hash("correct horse battery staple".toCharArray())

    assertFalse(PasswordHasher.verify("wrong password".toCharArray(), hash))
}

fun testTwoHashesOfSamePasswordDiffer() {
    val a = PasswordHasher.hash("same password".toCharArray())
    val b = PasswordHasher.hash("same password".toCharArray())

    assertNotEquals(a, b)
}

fun testVerifyRejectsMalformedStoredHash() {
    assertFalse(PasswordHasher.verify("anything".toCharArray(), "not-a-valid-hash"))
}
