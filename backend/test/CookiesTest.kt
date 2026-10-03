import proof.api.parseCookies
import kotlin.test.assertEquals
import kotlin.test.assertNull

fun testParseCookiesParsesMultiplePairs() {
    val cookies = parseCookies("proof_session=abc-123; other=value")

    assertEquals("abc-123", cookies["proof_session"])
    assertEquals("value", cookies["other"])
}

fun testParseCookiesHandlesNullAndBlank() {
    assertEquals(emptyMap(), parseCookies(null))
    assertEquals(emptyMap(), parseCookies(""))
}

fun testParseCookiesMissingKeyReturnsNull() {
    val cookies = parseCookies("other=value")

    assertNull(cookies["proof_session"])
}
