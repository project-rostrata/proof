package proof.api

import proof.db.SessionRepository
import java.util.UUID

class LogoutHandler(private val sessions: SessionRepository, private val secureCookies: Boolean) {
    // Reads the cookie directly rather than going through requireAuth: an already-expired
    // or missing session should still "succeed" from the client's perspective, not 401.
    fun handle(ctx: RouteContext): ApiResult<String> {
        val token = requestCookie(ctx.exchange, SESSION_COOKIE_NAME)
        token?.let { runCatching { UUID.fromString(it) }.getOrNull() }?.let { sessions.delete(it) }
        clearCookie(ctx.exchange, SESSION_COOKIE_NAME, secureCookies)
        return Ok("""{"status":"ok"}""")
    }
}
