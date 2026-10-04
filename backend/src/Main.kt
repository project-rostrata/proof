import com.sun.net.httpserver.HttpServer
import proof.api.EditsHandler
import proof.api.ExportHandler
import proof.api.LoginHandler
import proof.api.LogoutHandler
import proof.api.MeHandler
import proof.api.PhotoLocator
import proof.api.PhotosHandler
import proof.api.ProjectsHandler
import proof.api.RegisterHandler
import proof.api.Router
import proof.api.StaticFileHandler
import proof.api.healthHandler
import proof.api.requireAuth
import proof.api.requireAuthStream
import proof.auth.AuthConfig
import proof.auth.LoginThrottle
import proof.db.ConnectionPool
import proof.db.Database
import proof.db.MigrationRunner
import proof.db.PhotoRepository
import proof.db.ProjectRepository
import proof.db.SessionRepository
import proof.db.UserRepository
import proof.fs.cacheRoot
import proof.fs.tmpRoot
import proof.image.Rendition
import proof.image.Renditions
import proof.index.Locks
import proof.index.Reconciler
import java.net.InetSocketAddress
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.logging.Level
import java.util.logging.Logger

private val logger = Logger.getLogger("proof")

private const val HTTP_THREADS = 8

// Concurrent full-resolution decodes for thumbnails/previews. Each needs ~100+ MB of heap for a
// 24 MP photo (AGENTS.md "Concurrency").
private const val DECODE_SLOTS = 2

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
        allowRegistration = (System.getenv("PROOF_ALLOW_REGISTRATION") ?: "false").toBoolean(),
    )
    // The default covers the HTTP pool plus headroom for the background work later phases add.
    val dbPoolSize = (System.getenv("PROOF_DB_POOL_SIZE") ?: "10").toInt()
    val maxUploadBytes = (System.getenv("PROOF_MAX_UPLOAD_BYTES") ?: "100000000").toLong()
    // The backstop reconciliation pass (index/Reconciler.kt). Opening a project already reconciles
    // it, so this only catches what nobody has looked at. 0 turns it off.
    val reconcileIntervalMinutes = (System.getenv("PROOF_RECONCILE_INTERVAL_MINUTES") ?: "15").toLong()

    Files.createDirectories(dataRoot)
    clearTmp(tmpRoot(dataRoot))
    val pool = ConnectionPool.open(env("PROOF_DB_URL"), env("PROOF_DB_USER"), env("PROOF_DB_PASSWORD"), dbPoolSize)
    pool.use { connection -> MigrationRunner(connection, migrationsDir).run() }
    val database = Database(pool)

    val app = buildApp(
        frontendDir = frontendDir,
        dataRoot = dataRoot,
        database = database,
        renditions = Renditions(cacheRoot(dataRoot), DECODE_SLOTS),
        renditionExecutor = daemonPool("proof-renditions", DECODE_SLOTS),
        authConfig = authConfig,
        maxUploadBytes = maxUploadBytes,
    )
    val server = createServer(port, app.router)
    server.start()
    if (reconcileIntervalMinutes > 0) scheduleReconciliation(app.reconciler, reconcileIntervalMinutes)
    Runtime.getRuntime().addShutdownHook(Thread { server.stop(1) })

    logger.info("proof listening on port ${server.address.port}")
}

// Everything the server runs, wired once: the router for requests, and the reconciler the
// background pass shares with them.
data class App(val router: Router, val reconciler: Reconciler)

fun buildApp(
    frontendDir: Path,
    dataRoot: Path,
    database: Database,
    renditions: Renditions,
    renditionExecutor: ExecutorService,
    authConfig: AuthConfig,
    maxUploadBytes: Long,
): App {
    val users = UserRepository(database)
    val sessions = SessionRepository(database)
    val projects = ProjectRepository(database)
    val photos = PhotoRepository(database)
    val locks = Locks()
    val reconciler = Reconciler(dataRoot, users, projects, photos, renditions, locks)

    val staticFileHandler = StaticFileHandler(frontendDir)
    val projectsHandler = ProjectsHandler(projects, photos, renditions, dataRoot, locks, reconciler)
    val locator = PhotoLocator(photos, dataRoot)
    val photosHandler = PhotosHandler(projects, photos, locator, renditions, renditionExecutor, dataRoot, maxUploadBytes, locks, reconciler)
    val exportHandler = ExportHandler(projects, photos, dataRoot)
    val editsHandler = EditsHandler(photos, locator, renditions, renditionExecutor, dataRoot, maxUploadBytes, locks)
    val registerHandler = RegisterHandler(users, sessions, dataRoot, authConfig)
    val loginHandler = LoginHandler(users, sessions, authConfig, LoginThrottle())
    val logoutHandler = LogoutHandler(sessions, authConfig.secureCookies)
    val meHandler = MeHandler()

    val router = Router()
    router.get("/api/health", ::healthHandler)
    router.post("/api/register", registerHandler::handle)
    router.post("/api/login", loginHandler::handle)
    router.post("/api/logout", logoutHandler::handle)
    router.get("/api/me", requireAuth(sessions, users, meHandler::handle))
    router.get("/api/projects", requireAuth(sessions, users, projectsHandler::list))
    router.post("/api/projects", requireAuth(sessions, users, projectsHandler::create))
    router.patch("/api/projects/:projectId", requireAuth(sessions, users, projectsHandler::rename))
    router.delete("/api/projects/:projectId", requireAuth(sessions, users, projectsHandler::delete))
    router.get("/api/projects/:projectId/photos", requireAuth(sessions, users, photosHandler::list))
    router.getStream("/api/projects/:projectId/export", requireAuthStream(sessions, users, exportHandler::export))
    router.post("/api/projects/:projectId/photos", requireAuth(sessions, users, photosHandler::upload))
    router.getStream("/api/photos/:photoId/thumb", requireAuthStream(sessions, users, photosHandler.rendition(Rendition.THUMB)))
    router.getStream("/api/photos/:photoId/preview", requireAuthStream(sessions, users, photosHandler.rendition(Rendition.PREVIEW)))
    router.getStream("/api/photos/:photoId/original", requireAuthStream(sessions, users, photosHandler::original))
    router.patch("/api/photos/:photoId", requireAuth(sessions, users, photosHandler::cull))
    router.getStream("/api/photos/:photoId/source", requireAuthStream(sessions, users, photosHandler.rendition(Rendition.SOURCE)))
    router.get("/api/photos/:photoId/edit", requireAuth(sessions, users, editsHandler::get))
    router.put("/api/photos/:photoId/edit", requireAuth(sessions, users, editsHandler::put))
    router.delete("/api/photos/:photoId/edit", requireAuth(sessions, users, editsHandler::delete))
    router.serveStatic(staticFileHandler::serve)
    return App(router, reconciler)
}

// The first pass runs a minute after startup, to catch anything changed while proof was down, then
// at the interval. One thread: a pass never overlaps the next one.
private fun scheduleReconciliation(reconciler: Reconciler, intervalMinutes: Long) {
    val scheduler = Executors.newSingleThreadScheduledExecutor { task -> Thread(task, "proof-reconcile").apply { isDaemon = true } }
    scheduler.scheduleWithFixedDelay(
        {
            try {
                reconciler.reconcileEveryone()
            } catch (e: Exception) {
                logger.log(Level.SEVERE, "reconciliation pass failed", e) // an escaped exception would cancel the schedule
            }
        },
        60, intervalMinutes * 60, TimeUnit.SECONDS,
    )
}

// Bounded pool of plain blocking handlers (AGENTS.md "Concurrency"). Port 0 binds an ephemeral port
// (used by the tests). The pool's threads are daemons: HttpServer's own dispatcher thread is what keeps
// the process alive, and server.stop() doesn't shut a custom executor down, so non-daemon handler
// threads would outlive a stopped server (e.g. hang the test runner after the HTTP tests).
fun createServer(port: Int, router: Router): HttpServer {
    val server = HttpServer.create(InetSocketAddress(port), 0)
    server.executor = daemonPool("proof-http", HTTP_THREADS)
    server.createContext("/", router.toHttpHandler())
    return server
}

fun daemonPool(name: String, threads: Int): ExecutorService {
    val threadIds = AtomicInteger()
    return Executors.newFixedThreadPool(threads) { task ->
        Thread(task, "$name-${threadIds.incrementAndGet()}").apply { isDaemon = true }
    }
}

// Leftovers from uploads interrupted by a crash or restart. Nothing references them.
private fun clearTmp(dir: Path) {
    if (!Files.exists(dir)) return
    Files.list(dir).use { files -> files.forEach(Files::deleteIfExists) }
}
