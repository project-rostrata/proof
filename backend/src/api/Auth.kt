package proof.api

import proof.db.SessionRepository
import proof.db.UserRepository
import java.util.UUID

// The request-scoped identity every authenticated handler gets. Resolved once here rather than in
// each handler. Handlers need the username as well as the id, because a user's data directory is
// named by username (fs/UserRoot.kt).
data class AuthenticatedUser(val id: UUID, val username: String)

// Adapted from shelf's Auth.kt with the device-token (Bearer) path removed. That existed for shelf's
// Android app, and proof only has the browser's session cookie.
private fun resolveAuthenticatedUser(ctx: RouteContext, sessions: SessionRepository, users: UserRepository): AuthenticatedUser? {
    val cookieToken = requestCookie(ctx.exchange, SESSION_COOKIE_NAME)
    val sessionId = cookieToken?.let { runCatching { UUID.fromString(it) }.getOrNull() } ?: return null
    val session = sessions.findValid(sessionId) ?: return null
    val user = users.findById(session.userId) ?: return null
    return AuthenticatedUser(user.id, user.username)
}

fun requireAuth(
    sessions: SessionRepository,
    users: UserRepository,
    inner: (RouteContext, AuthenticatedUser) -> ApiResult<String>,
): Handler = { ctx ->
    val user = resolveAuthenticatedUser(ctx, sessions, users)
    if (user == null) Err(401, "UNAUTHORIZED", "Missing or invalid session") else inner(ctx, user)
}

fun requireAuthStream(
    sessions: SessionRepository,
    users: UserRepository,
    inner: (RouteContext, AuthenticatedUser) -> StreamResult,
): StreamHandler = { ctx ->
    val user = resolveAuthenticatedUser(ctx, sessions, users)
    if (user == null) StreamFailed(Err(401, "UNAUTHORIZED", "Missing or invalid session")) else inner(ctx, user)
}
