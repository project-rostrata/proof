import proof.auth.LoginThrottle
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.assertEquals
import kotlin.test.assertNull

private class TestClock(var now: Instant = Instant.parse("2026-10-03T12:00:00Z")) : Clock() {
    override fun instant(): Instant = now
    override fun getZone() = ZoneOffset.UTC
    override fun withZone(zone: java.time.ZoneId?) = this
}

fun testAUsernameIsRefusedAfterTooManyFailures() {
    val clock = TestClock()
    val throttle = LoginThrottle(clock)
    repeat(LoginThrottle.MAX_FAILURES - 1) { throttle.recordFailure("casey") }
    assertNull(throttle.retryAfter("casey"), "still allowed below the limit")
    throttle.recordFailure("casey")
    assertEquals(LoginThrottle.WINDOW, throttle.retryAfter("casey"))
    assertNull(throttle.retryAfter("someone else"), "other usernames are unaffected")
}

fun testTheRefusalEndsWhenTheWindowRunsOut() {
    val clock = TestClock()
    val throttle = LoginThrottle(clock)
    repeat(LoginThrottle.MAX_FAILURES) { throttle.recordFailure("casey") }
    clock.now = clock.now.plus(LoginThrottle.WINDOW).minusSeconds(60)
    assertEquals(Duration.ofSeconds(60), throttle.retryAfter("casey"))
    clock.now = clock.now.plusSeconds(60)
    assertNull(throttle.retryAfter("casey"))
    throttle.recordFailure("casey")
    assertNull(throttle.retryAfter("casey"), "a fresh window starts from one failure")
}

fun testASuccessfulSignInClearsTheCount() {
    val throttle = LoginThrottle(TestClock())
    repeat(LoginThrottle.MAX_FAILURES - 1) { throttle.recordFailure("casey") }
    throttle.recordSuccess("casey")
    throttle.recordFailure("casey")
    assertNull(throttle.retryAfter("casey"))
}
