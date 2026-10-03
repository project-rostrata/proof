package proof.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import proof.auth.AuthConfig
import proof.auth.LoginThrottle
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
    private val throttle: LoginThrottle,
) {
    // Verified against when the username doesn't exist, so a wrong username takes as long as a
    // wrong password. Otherwise the response time would reveal which usernames exist.
    private val decoyHash: String by lazy { PasswordHasher.hash(CharArray(16) { 'x' }) }

    fun handle(ctx: RouteContext): ApiResult<String> {
        val body = ctx.readBody() // outside the try: an oversized body is a 413, not a parse error
        val request = try {
            Json.decodeFromString<LoginRequest>(body)
        } catch (e: Exception) {
            return Err(400, "INVALID_BODY", "Malformed request body")
        }

        throttle.retryAfter(request.username)?.let { wait ->
            val minutes = maxOf(1, (wait.toSeconds() + 59) / 60)
            return Err(429, "TOO_MANY_ATTEMPTS", "Too many failed sign-ins. Try again in $minutes minute${if (minutes == 1L) "" else "s"}")
        }

        val user = users.findByUsername(request.username)
        val passwordChars = request.password.toCharArray()
        // Same INVALID_CREDENTIALS error, and the same hashing work, whether the username doesn't
        // exist or the password is wrong: never reveal which one, to avoid username enumeration.
        val valid = try {
            PasswordHasher.verify(passwordChars, user?.passwordHash ?: decoyHash) && user != null
        } finally {
            passwordChars.fill('\u0000')
        }

        if (user == null || !valid) {
            throttle.recordFailure(request.username)
            return Err(401, "INVALID_CREDENTIALS", "Invalid username or password")
        }
        throttle.recordSuccess(request.username)

        val expiresAt = Instant.now().plus(config.sessionDurationHours, ChronoUnit.HOURS)
        val session = sessions.create(user.id, expiresAt)
        setCookie(ctx.exchange, SESSION_COOKIE_NAME, session.id.toString(), config.sessionDurationHours * 3600, config.secureCookies)

        return Ok(Json.encodeToString(AuthResponse(user.id.toString(), user.username)))
    }
}
