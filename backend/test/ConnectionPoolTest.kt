import proof.db.ConnectionPool
import java.lang.reflect.Proxy
import java.sql.Connection
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

// A Connection is a large interface — a Proxy that no-ops every method is enough here, since
// these tests only care about pool borrow/return identity, never about running real SQL.
private fun fakeConnection(): Connection =
    Proxy.newProxyInstance(Connection::class.java.classLoader, arrayOf(Connection::class.java)) { _, _, _ -> null } as Connection

fun testUseReturnsTheBlocksResult() {
    val pool = ConnectionPool(listOf(fakeConnection()))

    val result = pool.use { 42 }

    assertEquals(42, result)
}

fun testUseHandsTheBlockOneOfThePooledConnections() {
    val connection = fakeConnection()
    val pool = ConnectionPool(listOf(connection))

    val seen = pool.use { it }

    assertSame(connection, seen)
}

// A borrow of an empty (fully-checked-out) single-connection pool must complete once the first
// use() returns the connection — if the pool leaked it instead, this would hang forever rather
// than fail cleanly, so the borrow runs on a separate thread with a bounded wait.
fun testConnectionIsReturnedToThePoolAfterUse() {
    val connection = fakeConnection()
    val pool = ConnectionPool(listOf(connection))
    pool.use { }

    val executor = Executors.newSingleThreadExecutor()
    val secondBorrow = executor.submit<Connection> { pool.use { it } }
    val seenAgain = secondBorrow.get(2, TimeUnit.SECONDS)
    executor.shutdown()

    assertSame(connection, seenAgain)
}

fun testConnectionIsReturnedToThePoolEvenWhenTheBlockThrows() {
    val connection = fakeConnection()
    val pool = ConnectionPool(listOf(connection))
    try {
        pool.use { throw RuntimeException("boom") }
    } catch (e: RuntimeException) {
        // expected — the point is what happens to the connection afterward, not this exception
    }

    val executor = Executors.newSingleThreadExecutor()
    val borrowAfterThrow = executor.submit<Connection> { pool.use { it } }
    val seenAfter = borrowAfterThrow.get(2, TimeUnit.SECONDS)
    executor.shutdown()

    assertSame(connection, seenAfter)
}

fun testAMultiConnectionPoolLetsEachConnectionBeBorrowedIndependently() {
    // Reference-identity comparisons throughout: the fake connections are no-op Proxy instances
    // whose hashCode()/equals() also return null through the same invocation handler, so a
    // hash-based collection (Set, etc.) would NPE the moment it tried to hash one — not a
    // real-world concern for actual JDBC connections, just a fake-double limitation to work
    // around here.
    val a = fakeConnection()
    val b = fakeConnection()
    val pool = ConnectionPool(listOf(a, b))

    val first = pool.use { it }
    val second = pool.use { it }

    assertTrue((first === a && second === b) || (first === b && second === a), "each pooled connection was handed out exactly once")
}
