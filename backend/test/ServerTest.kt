import proof.auth.AuthConfig
import proof.db.ConnectionPool
import proof.db.Database
import proof.db.SessionRepository
import proof.db.UserRepository
import java.lang.reflect.Proxy
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.sql.Connection
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// A Connection that fails loudly if anything touches it: these tests only cover routes that must
// answer without a database round trip, so any DB access is itself a bug.
private val noDatabase = Database(ConnectionPool(listOf(
    Proxy.newProxyInstance(Connection::class.java.classLoader, arrayOf(Connection::class.java)) { _, method, _ ->
        error("unexpected database access: ${method.name}")
    } as Connection,
)))

// End-to-end over real HTTP: the same router Main.kt builds, on an ephemeral port. Registration and
// login need Postgres and are covered by the smoke test in docs/handoff.md, not here.
private fun withServer(block: (base: String, client: HttpClient) -> Unit) {
    val frontend = Files.createTempDirectory("proof-server-test")
    Files.writeString(frontend.resolve("index.html"), "<!doctype html>")
    val router = buildRouter(
        frontendDir = frontend,
        dataRoot = frontend.resolve("data"),
        users = UserRepository(noDatabase),
        sessions = SessionRepository(noDatabase),
        authConfig = AuthConfig(sessionDurationHours = 1, secureCookies = false),
    )
    val server = createServer(0, router)
    server.start()
    try {
        block("http://127.0.0.1:${server.address.port}", HttpClient.newHttpClient())
    } finally {
        server.stop(0)
        Files.walk(frontend).sorted(Comparator.reverseOrder()).forEach { Files.delete(it) }
    }
}

private fun HttpClient.get(url: String): HttpResponse<String> =
    send(HttpRequest.newBuilder(URI.create(url)).GET().build(), HttpResponse.BodyHandlers.ofString())

fun testHealthEndpoint() = withServer { base, client ->
    val response = client.get("$base/api/health")

    assertEquals(200, response.statusCode())
    assertEquals("""{"status":"ok"}""", response.body())
    assertTrue(response.headers().firstValue("Content-Type").get().startsWith("application/json"))
}

// A mistyped API route gets the JSON error envelope, never the static fallback.
fun testUnknownApiRouteIsJson404() = withServer { base, client ->
    val response = client.get("$base/api/nope")

    assertEquals(404, response.statusCode())
    assertEquals("""{"error":{"code":"NOT_FOUND","message":"No route for GET /api/nope"}}""", response.body())
}

fun testFrontendServedAtRoot() = withServer { base, client ->
    val response = client.get("$base/")

    assertEquals(200, response.statusCode())
    assertEquals("<!doctype html>", response.body())
}


fun testMeWithoutSessionIs401() = withServer { base, client ->
    val response = client.get("$base/api/me")

    assertEquals(401, response.statusCode())
    assertEquals("""{"error":{"code":"UNAUTHORIZED","message":"Missing or invalid session"}}""", response.body())
}

// A cookie that isn't even a UUID is rejected before any session lookup.
fun testMeWithMalformedSessionCookieIs401() = withServer { base, client ->
    val request = HttpRequest.newBuilder(URI.create("$base/api/me")).header("Cookie", "proof_session=not-a-uuid").GET().build()
    val response = client.send(request, HttpResponse.BodyHandlers.ofString())

    assertEquals(401, response.statusCode())
}

fun testRegisterWithMalformedBodyIs400() = withServer { base, client ->
    val request = HttpRequest.newBuilder(URI.create("$base/api/register")).POST(HttpRequest.BodyPublishers.ofString("{nope")).build()
    val response = client.send(request, HttpResponse.BodyHandlers.ofString())

    assertEquals(400, response.statusCode())
}

fun testRegisterRejectsLeadingDotUsernameBeforeTouchingTheDatabase() = withServer { base, client ->
    val body = """{"username":".cache","password":"long enough password"}"""
    val request = HttpRequest.newBuilder(URI.create("$base/api/register")).POST(HttpRequest.BodyPublishers.ofString(body)).build()
    val response = client.send(request, HttpResponse.BodyHandlers.ofString())

    assertEquals(400, response.statusCode())
}
