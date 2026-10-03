package proof.auth

import java.security.SecureRandom
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

private const val ALGORITHM = "PBKDF2WithHmacSHA256"
private const val ITERATIONS = 600_000 // current OWASP minimum for PBKDF2-HMAC-SHA256
private const val KEY_LENGTH_BITS = 256
private const val SALT_LENGTH_BYTES = 16
private const val PREFIX = "pbkdf2-sha256"

// Copied from shelf. Stateless, so an `object` is allowed (AGENTS.md "Dependency injection").
object PasswordHasher {
    private val secureRandom = SecureRandom()

    // Format: pbkdf2-sha256$<iterations>$<base64 salt>$<base64 hash> — the iteration
    // count travels with the hash so it can be raised later without a schema change
    // or invalidating existing passwords.
    fun hash(password: CharArray): String {
        val salt = ByteArray(SALT_LENGTH_BYTES).also { secureRandom.nextBytes(it) }
        val derived = derive(password, salt, ITERATIONS)
        return "$PREFIX\$$ITERATIONS\$${encode(salt)}\$${encode(derived)}"
    }

    fun verify(password: CharArray, stored: String): Boolean {
        val parts = stored.split("$")
        if (parts.size != 4 || parts[0] != PREFIX) return false
        val iterations = parts[1].toIntOrNull() ?: return false
        val salt = decode(parts[2]) ?: return false
        val expected = decode(parts[3]) ?: return false
        val actual = derive(password, salt, iterations)
        return constantTimeEquals(actual, expected)
    }

    private fun derive(password: CharArray, salt: ByteArray, iterations: Int): ByteArray {
        val spec = PBEKeySpec(password, salt, iterations, KEY_LENGTH_BITS)
        try {
            return SecretKeyFactory.getInstance(ALGORITHM).generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }

    private fun encode(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)

    private fun decode(value: String): ByteArray? = try {
        Base64.getDecoder().decode(value)
    } catch (e: IllegalArgumentException) {
        null
    }

    private fun constantTimeEquals(a: ByteArray, b: ByteArray): Boolean {
        if (a.size != b.size) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].toInt() xor b[i].toInt())
        return diff == 0
    }
}
