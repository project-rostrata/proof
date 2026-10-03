package proof.db

import java.sql.PreparedStatement
import java.sql.ResultSet

// Copied from shelf. A pooled JDBC connection per call. ConnectionPool.use already provides thread
// safety (borrow/return via ArrayBlockingQueue), so each method here just borrows, runs its
// statement, and lets the pool reclaim the connection.
//
// Every query is a PreparedStatement with parameters bound via `bind` — never string
// interpolation into SQL.
class Database(private val pool: ConnectionPool) {
    fun <T> queryOne(sql: String, bind: (PreparedStatement) -> Unit = {}, mapRow: (ResultSet) -> T): T =
        pool.use { connection ->
            connection.prepareStatement(sql).use { statement ->
                bind(statement)
                statement.executeQuery().use { resultSet ->
                    check(resultSet.next()) { "query returned no rows: $sql" }
                    mapRow(resultSet)
                }
            }
        }

    fun <T> queryOneOrNull(sql: String, bind: (PreparedStatement) -> Unit = {}, mapRow: (ResultSet) -> T): T? =
        pool.use { connection ->
            connection.prepareStatement(sql).use { statement ->
                bind(statement)
                statement.executeQuery().use { resultSet ->
                    if (resultSet.next()) mapRow(resultSet) else null
                }
            }
        }

    fun <T> queryList(sql: String, bind: (PreparedStatement) -> Unit = {}, mapRow: (ResultSet) -> T): List<T> =
        pool.use { connection ->
            connection.prepareStatement(sql).use { statement ->
                bind(statement)
                statement.executeQuery().use { resultSet ->
                    val results = mutableListOf<T>()
                    while (resultSet.next()) results += mapRow(resultSet)
                    results
                }
            }
        }

    fun update(sql: String, bind: (PreparedStatement) -> Unit = {}): Int = pool.use { connection ->
        connection.prepareStatement(sql).use { statement ->
            bind(statement)
            statement.executeUpdate()
        }
    }
}
