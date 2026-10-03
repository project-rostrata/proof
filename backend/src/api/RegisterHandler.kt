package proof.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import proof.auth.AuthConfig
import proof.auth.PasswordHasher
import proof.db.SessionRepository
import proof.db.UserRepository
import proof.fs.isValidUsername
import proof.fs.userRoot
import java.nio.file.Files
import java.nio.file.Path
import java.sql.SQLException
import java.time.Instant
import java.time.temporal.ChronoUnit

@Serializable
private data class RegisterRequest(val username: String, val password: String)

private const val MIN_PASSWORD_LENGTH = 8
private const val UNIQUE_VIOLATION_SQLSTATE = "23505"

// Adapted from shelf's RegisterHandler. The only difference is the on-disk layout: one directory per
// user under $PROOF_DATA, which will hold that user's project directories.
class RegisterHandler(
    private val users: UserRepository,
    private val sessions: SessionRepository,
    private val dataRoot: Path,
    private val config: AuthConfig,
) {
    fun handle(ctx: RouteContext): ApiResult<String> {
        val body = ctx.readBody() // outside the try: an oversized body is a 413, not a parse error
        val request = try {
            Json.decodeFromString<RegisterRequest>(body)
        } catch (e: Exception) {
            return Err(400, "INVALID_BODY", "Malformed request body")
        }

        if (request.username.isBlank()) {
            return Err(400, "INVALID_INPUT", "username is required")
        }
        // The username becomes a real directory name (fs/UserRoot.kt), so it has to be safe as one.
        // It's checked before the password-hashing work so a bad username fails fast.
        if (!isValidUsername(request.username)) {
            return Err(400, "INVALID_INPUT", "username may only contain letters, numbers, dots, underscores, and hyphens, and may not start with a dot")
        }
        if (request.password.length < MIN_PASSWORD_LENGTH) {
            return Err(400, "INVALID_INPUT", "password must be at least $MIN_PASSWORD_LENGTH characters")
        }

        // Closed unless enabled, except for the very first account (AuthConfig). Checked after the
        // cheap input checks but before the deliberately slow password hashing.
        if (!config.allowRegistration && users.exists()) {
            return Err(403, "REGISTRATION_CLOSED", "Registration is closed. Ask whoever runs this proof to create your account")
        }

        val passwordChars = request.password.toCharArray()
        val passwordHash = try {
            PasswordHasher.hash(passwordChars)
        } finally {
            passwordChars.fill('\u0000')
        }

        val user = try {
            users.create(request.username, passwordHash)
        } catch (e: SQLException) {
            if (e.sqlState == UNIQUE_VIOLATION_SQLSTATE) {
                return Err(409, "USERNAME_TAKEN", "That username is already registered")
            }
            throw e
        }

        // Idempotent: a directory that already exists under this username (for example, one
        // bind-mounted in ahead of time) is left untouched.
        Files.createDirectories(userRoot(dataRoot, user.username))

        val expiresAt = Instant.now().plus(config.sessionDurationHours, ChronoUnit.HOURS)
        val session = sessions.create(user.id, expiresAt)
        setCookie(ctx.exchange, SESSION_COOKIE_NAME, session.id.toString(), config.sessionDurationHours * 3600, config.secureCookies)

        return Ok(Json.encodeToString(AuthResponse(user.id.toString(), user.username)))
    }
}
