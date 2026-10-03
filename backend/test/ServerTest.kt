import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// End-to-end over real HTTP: the same router Main.kt builds, on an ephemeral port.
private fun withServer(block: (base: String, client: HttpClient) -> Unit) {
    val frontend = Files.createTempDirectory("proof-server-test")
    Files.writeString(frontend.resolve("index.html"), "<!doctype html>")
    val server = createServer(0, buildRouter(frontend))
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

