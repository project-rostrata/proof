package proof.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import proof.db.CullView
import proof.db.PhotoRepository
import proof.db.PhotoRow
import proof.db.ProjectRepository
import proof.fs.Received
import proof.fs.fileMtime
import proof.fs.isValidPhotoFilename
import proof.fs.isValidProjectName
import proof.fs.makeShareable
import proof.fs.originalsDir
import proof.fs.receiveUpload
import proof.fs.resolveChild
import proof.fs.tmpRoot
import proof.fs.userRoot
import proof.image.CullState
import proof.image.FLAGS
import proof.image.Rendition
import proof.image.RenditionGroup
import proof.image.Renditions
import proof.image.SidecarUnreadable
import proof.image.Xmp
import proof.image.exceedsPixelLimit
import proof.image.group
import proof.image.readOriginalFacts
import proof.index.Locks
import proof.index.Reconciler
import proof.index.toNewPhoto
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.logging.Level
import java.util.logging.Logger

@Serializable
data class ApiPhoto(
    val id: String,
    val filename: String,
    val width: Int,
    val height: Int,
    val thumbUrl: String,
    val previewUrl: String,
    val originalUrl: String,
    val captureDisplay: String?,
    val cameraDisplay: String?,
    val exposureDisplay: String?,
    val sizeDisplay: String,
    val dimensionsDisplay: String,
    // Raw cull state: the UI needs these to show stars and flags and to know what a key toggles.
    val rating: Int,
    val flag: String,
    // Edit state: the editor reopens from the recipe, and always works from the original.
    val hasEdit: Boolean,
    val editVersion: String,         // "none" or the saved edit's version: sent back as ?base= on save
    val sourcePreviewUrl: String,    // a 2048 px preview of the *original*, for the editor
)

@Serializable
data class ApiView(val id: String, val label: String, val count: Int)

@Serializable
data class ApiProjectPhotos(val project: ApiProject, val views: List<ApiView>, val view: String, val minRating: Int, val photos: List<ApiPhoto>)

@Serializable
data class ApiCullResult(val photo: ApiPhoto, val views: List<ApiView>)

// Rendition URLs carry a version (the photo's file mtime, or its edit's once Phase 11 lands), so
// browsers can cache them forever and still pick up a regenerated thumbnail.
fun renditionUrl(photoId: UUID, kind: String, version: Instant?): String =
    "/api/photos/$photoId/$kind" + (version?.let { "?v=${it.toEpochMilli()}" } ?: "")

fun PhotoRow.toApi(): ApiPhoto {
    val version = editMtime ?: mtime
    return ApiPhoto(
        id = id.toString(),
        filename = filename,
        width = width,
        height = height,
        thumbUrl = renditionUrl(id, "thumb", version),
        previewUrl = renditionUrl(id, "preview", version),
        originalUrl = "/api/photos/$id/original",
        captureDisplay = captureDisplay(captureTime),
        cameraDisplay = cameraDisplay(cameraMake, cameraModel),
        exposureDisplay = exposureDisplay(focalLengthMm, fNumber, exposureTimeS, iso),
        sizeDisplay = fileSizeDisplay(sizeBytes),
        dimensionsDisplay = dimensionsDisplay(width, height),
        rating = rating,
        flag = flag,
        hasEdit = hasEdit,
        editVersion = editVersion(editMtime),
        sourcePreviewUrl = renditionUrl(id, "source", mtime),
    )
}

fun Map<CullView, Int>.toApi(): List<ApiView> = CullView.entries.map { ApiView(it.id, it.label, getValue(it)) }

class PhotosHandler(
    private val projects: ProjectRepository,
    private val photos: PhotoRepository,
    private val locator: PhotoLocator,
    private val renditions: Renditions,
    private val renditionExecutor: ExecutorService,
    private val dataRoot: Path,
    private val maxUploadBytes: Long,
    private val locks: Locks,
    private val reconciler: Reconciler,
) {
    private val logger = Logger.getLogger(PhotosHandler::class.qualifiedName)

    // GET /api/projects/:projectId/photos?view=all|picks|unrated|rejects&minRating=0..5
    fun list(ctx: RouteContext, user: AuthenticatedUser): ApiResult<String> {
        val project = ctx.uuidParam("projectId")?.let { projects.findOwned(it, user.id) } ?: return projectNotFound()
        val view = CullView.fromId(ctx.query["view"]) ?: return Err(400, "INVALID_INPUT", "view must be one of ${CullView.entries.joinToString { it.id }}")
        val minRating = (ctx.query["minRating"] ?: "0").toIntOrNull()?.takeIf { it in 0..5 }
            ?: return Err(400, "INVALID_INPUT", "minRating must be 0-5")
        // Pick up anything changed on disk outside the app first. A failure there is logged, and the
        // index is shown as it is.
        try {
            reconciler.reconcileProject(user.username, project)
        } catch (e: Exception) {
            logger.log(Level.WARNING, "reconciling project ${project.id} failed", e)
        }
        val summary = projects.listSummaries(user.id).firstOrNull { it.project.id == project.id } ?: return projectNotFound()
        return Ok(
            Json.encodeToString(
                ApiProjectPhotos(
                    project = summary.toApi(),
                    views = photos.viewCounts(project.id).toApi(),
                    view = view.id,
                    minRating = minRating,
                    photos = photos.listForProject(project.id, view, minRating).map { it.toApi() },
                ),
            ),
        )
    }

    // PATCH /api/photos/:photoId with either or both of {"rating": 0-5, "flag": "none|pick|reject"}.
    // The XMP sidecar is written first (it's the truth), then the index.
    // Returns the updated photo and fresh view counts, so the UI never recounts anything itself.
    fun cull(ctx: RouteContext, user: AuthenticatedUser): ApiResult<String> {
        val body = ctx.readBody().let { text -> runCatching { Json.parseToJsonElement(text).jsonObject }.getOrNull() }
            ?: return Err(400, "INVALID_BODY", "Malformed request body")
        val located = locator.locate(ctx, user) ?: return Err(404, "NOT_FOUND", "No such photo")
        val photo = located.photo
        val source = located.original
        // The sidecar's read-modify-write is under the project lock: rapid keypresses send PATCHes
        // that would otherwise race each other, and reconciliation re-reads sidecars.
        locks.project(photo.projectId) {
            val sidecar = Xmp.sidecarFor(source)
            val current = try {
                Xmp.read(sidecar)
            } catch (e: SidecarUnreadable) {
                return sidecarUnreadable(photo.filename)
            }
            val rating = when (val v = body["rating"]) {
                null -> current.rating
                else -> (v as? JsonPrimitive)?.intOrNull?.takeIf { it in 0..5 } ?: return Err(400, "INVALID_INPUT", "rating must be 0-5")
            }
            val flag = when (val v = body["flag"]) {
                null -> current.flag
                else -> (v as? JsonPrimitive)?.contentOrNull?.takeIf { it in FLAGS } ?: return Err(400, "INVALID_INPUT", "flag must be none, pick or reject")
            }
            try {
                Xmp.write(sidecar, CullState(rating, flag))
            } catch (e: SidecarUnreadable) {
                return sidecarUnreadable(photo.filename)
            }
            photos.updateCull(photo.id, rating, flag, fileMtime(sidecar))
        }
        val updated = photos.findOwned(photo.id, user.id)?.photo ?: return Err(404, "NOT_FOUND", "No such photo")
        return Ok(Json.encodeToString(ApiCullResult(updated.toApi(), photos.viewCounts(photo.projectId).toApi())))
    }

    // POST /api/projects/:projectId/photos?filename=IMG_0001.jpg with the file as the raw body: one
    // file per request (PROJECT_BRIEF.md §4). The browser runs a few of these at once.
    fun upload(ctx: RouteContext, user: AuthenticatedUser): ApiResult<String> {
        val project = ctx.uuidParam("projectId")?.let { projects.findOwned(it, user.id) } ?: return projectNotFound()
        val filename = ctx.query["filename"] ?: return Err(400, "INVALID_INPUT", "filename is required")
        val originals = resolveChild(userRoot(dataRoot, user.username), project.name, ::isValidProjectName)?.let(::originalsDir)
            ?: return Err(500, "INTERNAL_ERROR", "Stored project name is invalid")
        Files.createDirectories(originals)
        val target = resolveChild(originals, filename, ::isValidPhotoFilename)
            ?: return Err(400, "INVALID_FILENAME", "Only .jpg, .jpeg and .png files are supported, and the name can't start with a dot or contain / \\ : * ? \" < > |")

        val declared = ctx.exchange.requestHeaders.getFirst("Content-Length")?.toLongOrNull()
        if (declared != null && declared > maxUploadBytes) return tooLarge()

        val received = when (val r = receiveUpload(ctx.exchange.requestBody, tmpRoot(dataRoot), maxUploadBytes)) {
            is Received.File -> r
            Received.TooLarge -> return tooLarge()
            Received.NotAnImage -> return Err(400, "UNSUPPORTED_TYPE", "$filename isn't a JPEG or PNG")
        }
        try {
            val extension = filename.substringAfterLast('.').lowercase()
            if (extension !in received.type.extensions) {
                return Err(400, "UNSUPPORTED_TYPE", "$filename is a ${received.type.name} file, but its name says .$extension")
            }
            val facts = readOriginalFacts(received.path) ?: return Err(400, "UNREADABLE_IMAGE", "$filename couldn't be decoded")
            if (facts.exceedsPixelLimit()) return Err(400, "IMAGE_TOO_LARGE", "$filename is ${facts.width} × ${facts.height}, more pixels than proof accepts")
            // Under the project lock from the name check to the insert, so reconciliation can't
            // index the file in between (and then lose it to this upload's cleanup below).
            val photo = locks.project(project.id) {
                // Re-uploading the identical file (a retried batch) succeeds and returns the existing
                // photo. A different file under the same name is a conflict, never a silent overwrite.
                photos.findByFilename(project.id, filename)?.let { existing ->
                    return if (existing.contentSha256 == received.sha256) Ok(Json.encodeToString(existing.toApi()))
                    else Err(409, "FILENAME_TAKEN", "This project already has a different $filename")
                }
                // ATOMIC_MOVE is rename(2), which silently replaces an existing file. A file put in the
                // folder outside the app, and not indexed yet, must never be overwritten.
                if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
                    return Err(409, "FILENAME_TAKEN", "This project's folder already has a file called $filename")
                }
                Files.move(received.path, target, StandardCopyOption.ATOMIC_MOVE)
                makeShareable(target)
                try {
                    photos.insert(facts.toNewPhoto(project.id, filename, received.sizeBytes, fileMtime(target), received.sha256))
                } catch (e: Exception) {
                    Files.deleteIfExists(target) // the upload failed as a whole, so don't leave the file behind
                    throw e
                }
            }
            projects.touch(project.id)
            renditionExecutor.submit {
                try {
                    renditions.ensure(photo.id, target, photo.orientation)
                } catch (e: Exception) {
                    logger.log(Level.WARNING, "rendition generation failed for photo ${photo.id}", e)
                }
            }
            return Ok(Json.encodeToString(photo.toApi()))
        } finally {
            Files.deleteIfExists(received.path) // no-op once it has been moved into originals/
        }
    }

    // Thumbnails and previews are generated on first request if the background job hasn't
    // produced them yet (or the cache was cleared).
    // The display renditions (thumbnail, preview) show the saved render once there is one. The
    // source preview always shows the original. Missing ones are generated on first request.
    fun rendition(rendition: Rendition): (RouteContext, AuthenticatedUser) -> StreamResult = { ctx, user ->
        when (val located = locator.locate(ctx, user)) {
            null -> StreamFailed(Err(404, "NOT_FOUND", "No such photo"))
            else -> {
                val photo = located.photo
                val group = rendition.group()
                if (group == RenditionGroup.DISPLAY && photo.hasEdit && Files.isRegularFile(located.render)) {
                    renditions.ensure(photo.id, group, located.render, 1) // renders are saved upright
                } else {
                    renditions.ensure(photo.id, group, located.original, photo.orientation)
                }
                streamFile(renditions.path(photo.id, rendition), "image/jpeg", IMMUTABLE)
            }
        }
    }

    fun original(ctx: RouteContext, user: AuthenticatedUser): StreamResult {
        val located = locator.locate(ctx, user) ?: return StreamFailed(Err(404, "NOT_FOUND", "No such photo"))
        val type = if (located.photo.filename.substringAfterLast('.').lowercase() == "png") "image/png" else "image/jpeg"
        return streamFile(located.original, type, mapOf("Cache-Control" to "private, no-cache"))
    }

    private fun sidecarUnreadable(filename: String): Err =
        Err(409, "SIDECAR_UNREADABLE", "$filename.xmp exists but couldn't be read, so proof won't overwrite it (it may hold another tool's edits)")

    private fun tooLarge(): Err = Err(413, "TOO_LARGE", "Photos can be at most ${fileSizeDisplay(maxUploadBytes)}")
}

private val IMMUTABLE = mapOf("Cache-Control" to "private, max-age=31536000, immutable")

private fun streamFile(path: Path, contentType: String, headers: Map<String, String>): StreamResult =
    FileStream(
        contentType = contentType,
        fileName = path.fileName.toString(),
        contentLength = Files.size(path),
        asAttachment = false,
        headers = headers,
    ) { output -> Files.newInputStream(path).use { it.copyTo(output) } }

fun RouteContext.uuidParam(name: String): UUID? = pathParams[name]?.let { runCatching { UUID.fromString(it) }.getOrNull() }
