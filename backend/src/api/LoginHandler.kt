package proof.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import proof.auth.AuthConfig
import proof.auth.PasswordHasher
import proof.db.SessionRepository
import proof.db.UserRepository
import java.time.Instant
import java.time.temporal.ChronoUnit

@Serializable
private data class LoginRequest(val username: String, val password: String)

class LoginHandler(
    private val users: UserRepository,
    private val sessions: SessionRepository,
    private val config: AuthConfig,
) {
    fun handle(ctx: RouteContext): ApiResult<String> {
        val request = try {
            Json.decodeFromString<LoginRequest>(ctx.readBody())
        } catch (e: Exception) {
            return Err(400, "INVALID_BODY", "Malformed request body")
        }

        val user = users.findByUsername(request.username)
        val passwordChars = request.password.toCharArray()
        // Same INVALID_CREDENTIALS error whether the username doesn't exist or the
        // password is wrong — never reveal which one, to avoid username enumeration.
        val valid = try {
            user != null && PasswordHasher.verify(passwordChars, user.passwordHash)
        } finally {
            passwordChars.fill('\u0000')
        }

        if (user == null || !valid) {
            return Err(401, "INVALID_CREDENTIALS", "Invalid username or password")
        }

        val expiresAt = Instant.now().plus(config.sessionDurationHours, ChronoUnit.HOURS)
        val session = sessions.create(user.id, expiresAt)
        setCookie(ctx.exchange, SESSION_COOKIE_NAME, session.id.toString(), config.sessionDurationHours * 3600, config.secureCookies)

        return Ok(Json.encodeToString(AuthResponse(user.id.toString(), user.username)))
    }
}
