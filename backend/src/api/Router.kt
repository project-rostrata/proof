package proof.api

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpHandler
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.OutputStream
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.logging.Level
import java.util.logging.Logger

typealias Handler = (RouteContext) -> ApiResult<String>
typealias StreamHandler = (RouteContext) -> StreamResult

// Copied from shelf's Router.kt (V1_PLAN.md Phase 3), package renamed.
//
// Routes that don't return a JSON body (static files, photos, thumbnails, and previews) get their own
// parallel result type instead of bending ApiResult's Ok/Err
// contract to fit them. StreamFailed wraps a plain Err so error cases still produce the exact same
// JSON error envelope every other endpoint does.
sealed class StreamResult
data class FileStream(
    val contentType: String,
    val fileName: String,
    val contentLength: Long,
    val asAttachment: Boolean = true,
    val headers: Map<String, String> = emptyMap(), // proof addition: e.g. Cache-Control for renditions
    val write: (OutputStream) -> Unit,
) : StreamResult()
data class StreamFailed(val err: Err) : StreamResult()

class RouteContext(
    val pathParams: Map<String, String>,
    val query: Map<String, String>,
    val exchange: HttpExchange,
)

// JSON request bodies are small (a name, a rating, a password). The cap stops an anonymous request
// (login and register read a body) from making the server buffer an arbitrarily large one in memory.
// Uploads and edit saves stream their bodies instead, with their own caps.
const val MAX_JSON_BODY_BYTES = 64 * 1024

class BodyTooLarge : Exception("request body over $MAX_JSON_BODY_BYTES bytes")

fun RouteContext.readBody(): String {
    val bytes = exchange.requestBody.readNBytes(MAX_JSON_BODY_BYTES + 1)
    if (bytes.size > MAX_JSON_BODY_BYTES) throw BodyTooLarge()
    return bytes.decodeToString()
}

// Sent with every response. nosniff stops a browser from reinterpreting a file as another type,
// DENY stops other sites from framing proof (clickjacking), and same-origin keeps photo URLs out of
// the Referer header sent to other sites. (A full Content-Security-Policy isn't set: the editor
// needs WebGL, blob images, and inline styles from VanJS, so a strict one would mostly be
// exceptions.)
private val SECURITY_HEADERS = mapOf(
    "X-Content-Type-Options" to "nosniff",
    "X-Frame-Options" to "DENY",
    "Referrer-Policy" to "same-origin",
)

sealed class RouteHandler {
    data class Json(val handler: Handler) : RouteHandler()
    data class Stream(val handler: StreamHandler) : RouteHandler()
}

sealed class MatchResult {
    data class Matched(val routeHandler: RouteHandler, val pathParams: Map<String, String>) : MatchResult()
    object NotFound : MatchResult()
}

private sealed class Segment {
    data class Literal(val value: String) : Segment()
    data class Param(val name: String) : Segment()
}

private data class Route(val method: String, val segments: List<Segment>, val handler: RouteHandler)

fun parseQuery(raw: String?): Map<String, String> {
    if (raw.isNullOrEmpty()) return emptyMap()
    return raw.split('&').mapNotNull { pair ->
        val idx = pair.indexOf('=')
        if (idx < 0) null
        else URLDecoder.decode(pair.substring(0, idx), "UTF-8") to URLDecoder.decode(pair.substring(idx + 1), "UTF-8")
    }.toMap()
}

private fun splitPath(path: String): List<String> = path.trim('/').split('/').filter { it.isNotEmpty() }

class Router {
    private val logger = Logger.getLogger(Router::class.qualifiedName)
    private val routes = mutableListOf<Route>()
    private var staticFallback: ((String) -> StreamResult)? = null

    // Tried only when no /api/* route matched, method is GET, and the path isn't under /api/ —
    // a mistyped API route still gets a clean API-shaped 404, not a static "no such file".
    fun serveStatic(handler: (String) -> StreamResult) {
        staticFallback = handler
    }

    fun get(pattern: String, handler: Handler) {
        routes += Route("GET", parsePattern(pattern), RouteHandler.Json(handler))
    }

    fun post(pattern: String, handler: Handler) {
        routes += Route("POST", parsePattern(pattern), RouteHandler.Json(handler))
    }

    fun put(pattern: String, handler: Handler) {
        routes += Route("PUT", parsePattern(pattern), RouteHandler.Json(handler))
    }

    fun patch(pattern: String, handler: Handler) {
        routes += Route("PATCH", parsePattern(pattern), RouteHandler.Json(handler))
    }

    fun delete(pattern: String, handler: Handler) {
        routes += Route("DELETE", parsePattern(pattern), RouteHandler.Json(handler))
    }

    fun getStream(pattern: String, handler: StreamHandler) {
        routes += Route("GET", parsePattern(pattern), RouteHandler.Stream(handler))
    }

    private fun parsePattern(pattern: String): List<Segment> =
        splitPath(pattern).map {
            if (it.startsWith(":")) Segment.Param(it.substring(1)) else Segment.Literal(it)
        }

    fun match(method: String, path: String): MatchResult {
        val pathSegments = splitPath(path)
        val route = routes.firstOrNull { it.method == method && segmentsMatch(it.segments, pathSegments) }
            ?: return MatchResult.NotFound
        return MatchResult.Matched(route.handler, extractParams(route.segments, pathSegments))
    }

    private fun segmentsMatch(segments: List<Segment>, path: List<String>): Boolean {
        if (segments.size != path.size) return false
        return segments.zip(path).all { (seg, actual) ->
            when (seg) {
                is Segment.Literal -> seg.value == actual
                is Segment.Param -> true
            }
        }
    }

    private fun extractParams(segments: List<Segment>, path: List<String>): Map<String, String> =
        segments.zip(path).mapNotNull { (seg, actual) ->
            if (seg is Segment.Param) seg.name to URLDecoder.decode(actual, "UTF-8") else null
        }.toMap()

    fun toHttpHandler(): HttpHandler = HttpHandler { exchange ->
        try {
            dispatch(exchange)
        } finally {
            exchange.close()
        }
    }

    private fun dispatch(exchange: HttpExchange) {
        val method = exchange.requestMethod
        val path = exchange.requestURI.path
        when (val match = match(method, path)) {
            is MatchResult.NotFound -> {
                val fallback = staticFallback
                if (method == "GET" && !path.startsWith("/api/") && fallback != null) {
                    respondStream(exchange, guardedStream(method, path) { fallback(path) })
                } else {
                    respondJson(exchange, Err(404, "NOT_FOUND", "No route for $method $path"))
                }
            }
            is MatchResult.Matched -> {
                val ctx = RouteContext(match.pathParams, parseQuery(exchange.requestURI.rawQuery), exchange)
                when (val routeHandler = match.routeHandler) {
                    is RouteHandler.Json -> respondJson(exchange, guarded(method, path) { routeHandler.handler(ctx) })
                    is RouteHandler.Stream -> respondStream(exchange, guardedStream(method, path) { routeHandler.handler(ctx) })
                }
            }
        }
    }

    private fun guarded(method: String, path: String, block: () -> ApiResult<String>): ApiResult<String> = try {
        block()
    } catch (e: BodyTooLarge) {
        Err(413, "TOO_LARGE", "Request body too large")
    } catch (e: Exception) {
        logger.log(Level.SEVERE, "unhandled exception in handler for $method $path", e)
        Err(500, "INTERNAL_ERROR", "Unexpected server error")
    }

    private fun guardedStream(method: String, path: String, block: () -> StreamResult): StreamResult = try {
        block()
    } catch (e: Exception) {
        logger.log(Level.SEVERE, "unhandled exception in stream handler for $method $path", e)
        StreamFailed(Err(500, "INTERNAL_ERROR", "Unexpected server error"))
    }

    private fun respondJson(exchange: HttpExchange, result: ApiResult<String>) {
        val status: Int
        val body: String
        when (result) {
            is Ok -> {
                status = 200
                body = result.value
            }
            is Err -> {
                status = result.status
                body = Json.encodeToString(ErrorEnvelope(ErrorBody(result.code, result.message)))
            }
        }
        val bytes = body.toByteArray(Charsets.UTF_8)
        SECURITY_HEADERS.forEach { (name, value) -> exchange.responseHeaders.set(name, value) }
        exchange.responseHeaders.add("Content-Type", "application/json; charset=utf-8")
        exchange.sendResponseHeaders(status, bytes.size.toLong())
        exchange.responseBody.write(bytes)
    }

    private fun respondStream(exchange: HttpExchange, result: StreamResult) {
        when (result) {
            is StreamFailed -> respondJson(exchange, result.err)
            is FileStream -> {
                SECURITY_HEADERS.forEach { (name, value) -> exchange.responseHeaders.set(name, value) }
                exchange.responseHeaders.add("Content-Type", result.contentType)
                result.headers.forEach { (name, value) -> exchange.responseHeaders.add(name, value) }
                if (result.asAttachment) {
                    val encodedName = URLEncoder.encode(result.fileName, "UTF-8").replace("+", "%20")
                    exchange.responseHeaders.add("Content-Disposition", "attachment; filename*=UTF-8''$encodedName")
                }
                exchange.sendResponseHeaders(200, result.contentLength)
                result.write(exchange.responseBody)
            }
        }
    }
}
