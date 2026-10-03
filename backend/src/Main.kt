import com.sun.net.httpserver.HttpServer
import proof.api.LoginHandler
import proof.api.LogoutHandler
import proof.api.MeHandler
import proof.api.RegisterHandler
import proof.api.Router
import proof.api.StaticFileHandler
import proof.api.healthHandler
import proof.api.requireAuth
import proof.auth.AuthConfig
import proof.db.ConnectionPool
import proof.db.Database
import proof.db.MigrationRunner
import proof.db.SessionRepository
import proof.db.UserRepository
import java.net.InetSocketAddress
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.logging.Logger

private val logger = Logger.getLogger("proof")

private const val HTTP_THREADS = 8

private fun env(name: String): String = System.getenv(name) ?: error("$name is required")

// Composition root (AGENTS.md "Dependency injection"): every service is constructed here, once,
// and handed to whatever needs it. Configuration is environment variables only, PROOF_-prefixed.
fun main() {
    val port = (System.getenv("PROOF_PORT") ?: "8080").toInt()
    val frontendDir = Path.of(env("PROOF_FRONTEND_DIR"))
    val dataRoot = Path.of(env("PROOF_DATA"))
    val migrationsDir = Path.of(env("PROOF_MIGRATIONS_DIR"))
    val authConfig = AuthConfig(
        sessionDurationHours = (System.getenv("PROOF_SESSION_DURATION_HOURS") ?: "720").toLong(),
        secureCookies = (System.getenv("PROOF_SECURE_COOKIES") ?: "false").toBoolean(),
    )
    // The default covers the HTTP pool plus headroom for the background work later phases add.
    val dbPoolSize = (System.getenv("PROOF_DB_POOL_SIZE") ?: "10").toInt()

    Files.createDirectories(dataRoot)
    val pool = ConnectionPool.open(env("PROOF_DB_URL"), env("PROOF_DB_USER"), env("PROOF_DB_PASSWORD"), dbPoolSize)
    pool.use { connection -> MigrationRunner(connection, migrationsDir).run() }
    val database = Database(pool)

    val router = buildRouter(
        frontendDir = frontendDir,
        dataRoot = dataRoot,
        users = UserRepository(database),
        sessions = SessionRepository(database),
        authConfig = authConfig,
    )
    val server = createServer(port, router)
    server.start()
    Runtime.getRuntime().addShutdownHook(Thread { server.stop(1) })

    logger.info("proof listening on port ${server.address.port}")
}

fun buildRouter(
    frontendDir: Path,
    dataRoot: Path,
    users: UserRepository,
    sessions: SessionRepository,
    authConfig: AuthConfig,
): Router {
    val staticFileHandler = StaticFileHandler(frontendDir)
    val registerHandler = RegisterHandler(users, sessions, dataRoot, authConfig)
    val loginHandler = LoginHandler(users, sessions, authConfig)
    val logoutHandler = LogoutHandler(sessions, authConfig.secureCookies)
    val meHandler = MeHandler()

    val router = Router()
    router.get("/api/health", ::healthHandler)
    router.post("/api/register", registerHandler::handle)
    router.post("/api/login", loginHandler::handle)
    router.post("/api/logout", logoutHandler::handle)
    router.get("/api/me", requireAuth(sessions, users, meHandler::handle))
    router.serveStatic(staticFileHandler::serve)
    return router
}

// Bounded pool of plain blocking handlers (AGENTS.md "Concurrency"). Port 0 binds an ephemeral port
// (used by the tests). The pool's threads are daemons: HttpServer's own dispatcher thread is what keeps
// the process alive, and server.stop() doesn't shut a custom executor down, so non-daemon handler
// threads would outlive a stopped server (e.g. hang the test runner after the HTTP tests).
fun createServer(port: Int, router: Router): HttpServer {
    val server = HttpServer.create(InetSocketAddress(port), 0)
    val threadIds = AtomicInteger()
    server.executor = Executors.newFixedThreadPool(HTTP_THREADS) { task ->
        Thread(task, "proof-http-${threadIds.incrementAndGet()}").apply { isDaemon = true }
    }
    server.createContext("/", router.toHttpHandler())
    return server
}
