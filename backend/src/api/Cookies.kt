package proof.api

import com.sun.net.httpserver.HttpExchange

const val SESSION_COOKIE_NAME = "proof_session"

fun parseCookies(header: String?): Map<String, String> {
    if (header.isNullOrBlank()) return emptyMap()
    return header.split(";").mapNotNull { pair ->
        val trimmed = pair.trim()
        val idx = trimmed.indexOf('=')
        if (idx < 0) null else trimmed.substring(0, idx) to trimmed.substring(idx + 1)
    }.toMap()
}

fun requestCookie(exchange: HttpExchange, name: String): String? =
    parseCookies(exchange.requestHeaders.getFirst("Cookie"))[name]

fun setCookie(exchange: HttpExchange, name: String, value: String, maxAgeSeconds: Long, secure: Boolean) {
    val attributes = buildString {
        append("$name=$value")
        append("; Path=/")
        append("; Max-Age=$maxAgeSeconds")
        append("; HttpOnly")
        append("; SameSite=Lax")
        if (secure) append("; Secure")
    }
    exchange.responseHeaders.add("Set-Cookie", attributes)
}

fun clearCookie(exchange: HttpExchange, name: String, secure: Boolean) =
    setCookie(exchange, name, "", maxAgeSeconds = 0, secure = secure)
