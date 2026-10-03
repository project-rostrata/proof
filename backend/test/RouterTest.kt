import proof.api.MatchResult
import proof.api.Ok
import proof.api.Router
import proof.api.parseQuery
import kotlin.test.assertEquals
import kotlin.test.assertIs

fun testMatchesLiteralRoute() {
    val router = Router()
    router.get("/api/health") { Ok("ok") }

    val result = router.match("GET", "/api/health")

    assertIs<MatchResult.Matched>(result)
}

fun testMatchExtractsPathParam() {
    val router = Router()
    router.get("/s/:token") { ctx -> Ok(ctx.pathParams["token"] ?: "") }

    val result = router.match("GET", "/s/abc123")

    assertIs<MatchResult.Matched>(result)
    assertEquals("abc123", result.pathParams["token"])
}

fun testUnmatchedPathReturnsNotFound() {
    val router = Router()
    router.get("/api/health") { Ok("ok") }

    val result = router.match("GET", "/nope")

    assertIs<MatchResult.NotFound>(result)
}

fun testMethodMismatchReturnsNotFound() {
    val router = Router()
    router.get("/api/health") { Ok("ok") }

    val result = router.match("POST", "/api/health")

    assertIs<MatchResult.NotFound>(result)
}

fun testParseQueryDecodesMultipleParams() {
    val query = parseQuery("path=%2Ffoo%2Fbar&x=1")

    assertEquals("/foo/bar", query["path"])
    assertEquals("1", query["x"])
}

fun testParseQueryHandlesNullAndEmpty() {
    assertEquals(emptyMap(), parseQuery(null))
    assertEquals(emptyMap(), parseQuery(""))
}
