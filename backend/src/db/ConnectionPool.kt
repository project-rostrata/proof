package proof.db

import java.sql.Connection
import java.sql.DriverManager
import java.util.concurrent.ArrayBlockingQueue

// Copied from shelf. A small fixed-size pool: connections are opened once at startup, never grown or
// shrunk. `use` borrowing an empty pool blocks the calling thread until one is returned, which
// is the backpressure we want (a bounded number of concurrent DB operations) rather than either
// unbounded connection creation or reinventing what ArrayBlockingQueue already gives us for
// free: thread-safe borrow/return with exactly this blocking-when-empty behavior.
class ConnectionPool(connections: List<Connection>) {
    private val pool = ArrayBlockingQueue(connections.size, false, connections)

    fun <T> use(block: (Connection) -> T): T {
        val connection = pool.take()
        try {
            return block(connection)
        } finally {
            pool.put(connection)
        }
    }

    companion object {
        fun open(url: String, user: String, password: String, size: Int): ConnectionPool =
            ConnectionPool((1..size).map { DriverManager.getConnection(url, user, password) })
    }
}
