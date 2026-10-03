package proof.api

import proof.index.Locks
import proof.index.Reconciler
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import proof.db.PhotoRepository
import proof.db.ProjectRepository
import proof.db.ProjectSummaryRow
import proof.fs.isValidProjectName
import proof.fs.renameDirectory
import proof.fs.resolveChild
import proof.fs.userRoot
import proof.image.Renditions
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.Path
import java.sql.SQLException
import java.util.UUID
import java.util.logging.Level
import java.util.logging.Logger

@Serializable
data class ApiProject(
    val id: String,
    val name: String,
    val photoCount: Int,
    val photoCountDisplay: String,
    val coverThumbUrl: String?,
)

@Serializable
private data class ProjectNameRequest(val name: String)

private const val UNIQUE_VIOLATION_SQLSTATE = "23505"
private const val NAME_RULES = "Project names can't start with a dot, end with a dot or space, or contain / \\ : * ? \" < > |"

fun ProjectSummaryRow.toApi(): ApiProject = ApiProject(
    id = project.id.toString(),
    name = project.name,
    photoCount = photoCount,
    photoCountDisplay = photoCountDisplay(photoCount),
    coverThumbUrl = coverPhotoId?.let { renditionUrl(it, "thumb", coverVersion) },
)

// Projects are directories (PROJECT_BRIEF.md §3). The filesystem changes first and the index
// follows, so a crash in between leaves disk state that reconciliation (Phase 6) can repair. It
// never leaves an index row pointing at nothing.
class ProjectsHandler(
    private val projects: ProjectRepository,
    private val photos: PhotoRepository,
    private val renditions: Renditions,
    private val dataRoot: Path,
    private val locks: Locks,
    private val reconciler: Reconciler,
) {
    private val logger = Logger.getLogger(ProjectsHandler::class.qualifiedName)

    // Picks up project folders added, renamed, or deleted outside the app first. A failure there is
    // logged, and the index is shown as it is.
    fun list(ctx: RouteContext, user: AuthenticatedUser): ApiResult<String> {
        try {
            reconciler.reconcileProjectSet(user.id, user.username)
        } catch (e: Exception) {
            logger.log(Level.WARNING, "reconciling projects for ${user.username} failed", e)
        }
        return Ok(Json.encodeToString(projects.listSummaries(user.id).map { it.toApi() }))
    }

    fun create(ctx: RouteContext, user: AuthenticatedUser): ApiResult<String> {
        val name = readName(ctx) ?: return Err(400, "INVALID_BODY", "Malformed request body")
        val dir = resolveChild(userRoot(dataRoot, user.username), name, ::isValidProjectName)
            ?: return Err(400, "INVALID_NAME", NAME_RULES)
        val project = locks.user(user.id) {
            try {
                Files.createDirectory(dir)
            } catch (e: FileAlreadyExistsException) {
                return Err(409, "PROJECT_EXISTS", "A project called \"$name\" already exists")
            }
            try {
                projects.create(user.id, name)
            } catch (e: SQLException) {
                Files.deleteIfExists(dir) // created above and still empty
                if (e.sqlState == UNIQUE_VIOLATION_SQLSTATE) return Err(409, "PROJECT_EXISTS", "A project called \"$name\" already exists")
                throw e
            }
        }
        return Ok(Json.encodeToString(ProjectSummaryRow(project, 0, null, null).toApi()))
    }

    fun rename(ctx: RouteContext, user: AuthenticatedUser): ApiResult<String> {
        val project = ownedProject(ctx, user) ?: return projectNotFound()
        val newName = readName(ctx) ?: return Err(400, "INVALID_BODY", "Malformed request body")
        if (newName == project.name) return Ok(Json.encodeToString(summaryOf(user, project.id)))
        val root = userRoot(dataRoot, user.username)
        val from = resolveChild(root, project.name, ::isValidProjectName) ?: return Err(500, "INTERNAL_ERROR", "Stored project name is invalid")
        val to = resolveChild(root, newName, ::isValidProjectName) ?: return Err(400, "INVALID_NAME", NAME_RULES)
        locks.user(user.id) {
            if (!renameDirectory(from, to)) return Err(409, "PROJECT_EXISTS", "A project called \"$newName\" already exists")
            try {
                projects.rename(project.id, newName)
            } catch (e: SQLException) {
                renameDirectory(to, from)
                if (e.sqlState == UNIQUE_VIOLATION_SQLSTATE) return Err(409, "PROJECT_EXISTS", "A project called \"$newName\" already exists")
                throw e
            }
        }
        return Ok(Json.encodeToString(summaryOf(user, project.id)))
    }

    // Hard delete, as in shelf v1: the project directory with its originals, edits, and sidecars,
    // then the index rows, then the derived cache. The UI confirms first.
    fun delete(ctx: RouteContext, user: AuthenticatedUser): ApiResult<String> {
        val project = ownedProject(ctx, user) ?: return projectNotFound()
        val dir = resolveChild(userRoot(dataRoot, user.username), project.name, ::isValidProjectName)
            ?: return Err(500, "INTERNAL_ERROR", "Stored project name is invalid")
        val photoIds = locks.user(user.id) {
            locks.project(project.id) {
                val ids = photos.idsForProject(project.id)
                if (Files.exists(dir)) {
                    Files.walk(dir).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach(Files::delete) }
                }
                projects.delete(project.id)
                ids
            }
        }
        for (id in photoIds) {
            try {
                renditions.delete(id)
            } catch (e: Exception) {
                logger.warning("could not delete cached renditions for photo $id: ${e.message}")
            }
        }
        return Ok("""{"status":"ok"}""")
    }

    private fun ownedProject(ctx: RouteContext, user: AuthenticatedUser) =
        ctx.pathParams["projectId"]?.let { runCatching { UUID.fromString(it) }.getOrNull() }?.let { projects.findOwned(it, user.id) }

    private fun summaryOf(user: AuthenticatedUser, projectId: UUID): ApiProject =
        projects.listSummaries(user.id).first { it.project.id == projectId }.toApi()

    private fun readName(ctx: RouteContext): String? =
        runCatching { Json.decodeFromString<ProjectNameRequest>(ctx.readBody()).name }.getOrNull()
}

fun projectNotFound(): Err = Err(404, "NOT_FOUND", "No such project")
