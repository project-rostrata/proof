package proof.auth

import java.time.Clock
import java.time.Duration
import java.time.Instant

// Slows down password guessing against one account. After MAX_FAILURES failed sign-ins for a
// username within WINDOW, that username is refused (429) until the window runs out, and a successful
// sign-in clears it. It's keyed by username, not IP address: behind a reverse proxy every request
// comes from the proxy's address. The cost is that someone could keep an account's sign-in blocked,
// but existing sessions (30 days by default) keep working. Unknown usernames are counted the same
// way, so the throttle doesn't reveal which usernames exist. In memory: a restart resets it.
class LoginThrottle(private val clock: Clock = Clock.systemUTC()) {
    private data class Failures(val count: Int, val since: Instant)

    private val failures = HashMap<String, Failures>()

    // How long until this username may try again, or null if it may now.
    @Synchronized
    fun retryAfter(username: String): Duration? {
        val entry = failures[username] ?: return null
        val until = entry.since.plus(WINDOW)
        val now = clock.instant()
        if (!now.isBefore(until)) {
            failures.remove(username)
            return null
        }
        return if (entry.count >= MAX_FAILURES) Duration.between(now, until) else null
    }

    @Synchronized
    fun recordFailure(username: String) {
        val now = clock.instant()
        failures.values.removeIf { !now.isBefore(it.since.plus(WINDOW)) } // forget expired windows
        val entry = failures[username]
        failures[username] = if (entry == null) Failures(1, now) else entry.copy(count = entry.count + 1)
    }

    @Synchronized
    fun recordSuccess(username: String) {
        failures.remove(username)
    }

    companion object {
        const val MAX_FAILURES = 10
        val WINDOW: Duration = Duration.ofMinutes(15)
    }
}
