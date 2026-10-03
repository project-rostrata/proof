import com.sun.net.httpserver.HttpServer
import proof.api.Router
import proof.api.StaticFileHandler
import proof.api.healthHandler
import java.net.InetSocketAddress
import java.nio.file.Path
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.logging.Logger

private val logger = Logger.getLogger("proof")

// Composition root (AGENTS.md "Dependency injection"): every service is constructed here, once,
// and handed to whatever needs it. Configuration is environment variables only, PROOF_-prefixed.
fun main() {
    val port = (System.getenv("PROOF_PORT") ?: "8080").toInt()
    val frontendDir = System.getenv("PROOF_FRONTEND_DIR") ?: error("PROOF_FRONTEND_DIR is required")

    val server = createServer(port, buildRouter(Path.of(frontendDir)))
    server.start()
    Runtime.getRuntime().addShutdownHook(Thread { server.stop(1) })

    logger.info("proof listening on port ${server.address.port}")
}

fun buildRouter(frontendDir: Path): Router {
    val staticFileHandler = StaticFileHandler(frontendDir)

    val router = Router()
    router.get("/api/health", ::healthHandler)
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
    server.executor = Executors.newFixedThreadPool(8) { task ->
        Thread(task, "proof-http-${threadIds.incrementAndGet()}").apply { isDaemon = true }
    }
    server.createContext("/", router.toHttpHandler())
    return server
}
