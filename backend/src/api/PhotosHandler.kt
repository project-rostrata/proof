package proof.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import proof.db.CullView
import proof.db.NewPhoto
import proof.db.PhotoRepository
import proof.db.PhotoRow
import proof.db.ProjectRepository
import proof.fs.Received
import proof.fs.isValidPhotoFilename
import proof.fs.isValidProjectName
import proof.fs.originalsDir
import proof.fs.receiveUpload
import proof.fs.resolveChild
import proof.fs.tmpRoot
import proof.fs.userRoot
import proof.image.CullState
import proof.image.ExifReader
import proof.image.FLAGS
import proof.image.LABELS
import proof.image.Rendition
import proof.image.Renditions
import proof.image.SidecarUnreadable
import proof.image.Xmp
import proof.image.probeSize
import proof.image.swapsDimensions
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
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
    val label: String?,
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
        label = label,
    )
}

fun Map<CullView, Int>.toApi(): List<ApiView> = CullView.entries.map { ApiView(it.id, it.label, getValue(it)) }

// Per-photo locks for read-modify-write of a sidecar. Rapid keypresses on one photo send PATCHes
// that would otherwise race. Striped, so memory doesn't grow with the number of photos.
private val CULL_LOCKS = Array(64) { Any() }

// EXIF lives in the first segments of a JPEG (APP1 is capped at 64 KB) or before IDAT in a PNG,
// so only the head of the file is read for it.
private const val EXIF_SCAN_BYTES = 1 shl 20

class PhotosHandler(
    private val projects: ProjectRepository,
    private val photos: PhotoRepository,
    private val renditions: Renditions,
    private val renditionExecutor: ExecutorService,
    private val dataRoot: Path,
    private val maxUploadBytes: Long,
) {
    private val logger = Logger.getLogger(PhotosHandler::class.qualifiedName)

    // GET /api/projects/:projectId/photos?view=all|picks|unrated|rejects&minRating=0..5
    fun list(ctx: RouteContext, user: AuthenticatedUser): ApiResult<String> {
        val project = ctx.uuidParam("projectId")?.let { projects.findOwned(it, user.id) } ?: return projectNotFound()
        val view = CullView.fromId(ctx.query["view"]) ?: return Err(400, "INVALID_INPUT", "view must be one of ${CullView.entries.joinToString { it.id }}")
        val minRating = (ctx.query["minRating"] ?: "0").toIntOrNull()?.takeIf { it in 0..5 }
            ?: return Err(400, "INVALID_INPUT", "minRating must be 0-5")
        val summary = projects.listSummaries(user.id).first { it.project.id == project.id }
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

    // PATCH /api/photos/:photoId with any of {"rating": 0-5, "flag": "none|pick|reject",
    // "label": "Red"|...|null}. The XMP sidecar is written first (it's the truth), then the index.
    // Returns the updated photo and fresh view counts, so the UI never recounts anything itself.
    fun cull(ctx: RouteContext, user: AuthenticatedUser): ApiResult<String> {
        val body = runCatching { Json.parseToJsonElement(ctx.readBody()).jsonObject }.getOrNull()
            ?: return Err(400, "INVALID_BODY", "Malformed request body")
        val (photo, source) = locate(ctx, user) ?: return Err(404, "NOT_FOUND", "No such photo")
        synchronized(CULL_LOCKS[(photo.id.hashCode() and Int.MAX_VALUE) % CULL_LOCKS.size]) {
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
            val label = when (val v = body["label"]) {
                null -> current.label
                is JsonNull -> null
                else -> (v as? JsonPrimitive)?.contentOrNull?.takeIf { it in LABELS } ?: return Err(400, "INVALID_INPUT", "label must be one of ${LABELS.joinToString()} or null")
            }
            try {
                Xmp.write(sidecar, CullState(rating, flag, label))
            } catch (e: SidecarUnreadable) {
                return sidecarUnreadable(photo.filename)
            }
            photos.updateCull(photo.id, rating, flag, label)
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
            // Re-uploading the identical file (a retried batch) succeeds and returns the existing
            // photo. A different file under the same name is a conflict, never a silent overwrite.
            photos.findByFilename(project.id, filename)?.let { existing ->
                return if (existing.contentSha256 == received.sha256) Ok(Json.encodeToString(existing.toApi()))
                else Err(409, "FILENAME_TAKEN", "This project already has a different $filename")
            }
            val (storedW, storedH) = probeSize(received.path) ?: return Err(400, "UNREADABLE_IMAGE", "$filename couldn't be decoded")
            val exif = ExifReader.read(readHead(received.path))
            try {
                Files.move(received.path, target, StandardCopyOption.ATOMIC_MOVE)
            } catch (e: FileAlreadyExistsException) {
                return Err(409, "FILENAME_TAKEN", "This project already has a different $filename")
            }
            val photo = try {
                photos.insert(
                    NewPhoto(
                        projectId = project.id,
                        filename = filename,
                        sizeBytes = received.sizeBytes,
                        mtime = Files.getLastModifiedTime(target).toInstant(),
                        contentSha256 = received.sha256,
                        width = if (swapsDimensions(exif.orientation)) storedH else storedW,
                        height = if (swapsDimensions(exif.orientation)) storedW else storedH,
                        orientation = exif.orientation,
                        captureTime = exif.captureTime,
                        captureOffset = exif.captureOffset,
                        cameraMake = exif.make,
                        cameraModel = exif.model,
                        lens = exif.lens,
                        focalLengthMm = exif.focalLengthMm,
                        fNumber = exif.fNumber,
                        exposureTimeS = exif.exposureTimeS,
                        iso = exif.iso,
                    ),
                )
            } catch (e: Exception) {
                Files.deleteIfExists(target) // the upload failed as a whole, so don't leave the file behind
                throw e
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
    fun rendition(rendition: Rendition): (RouteContext, AuthenticatedUser) -> StreamResult = { ctx, user ->
        when (val located = locate(ctx, user)) {
            null -> StreamFailed(Err(404, "NOT_FOUND", "No such photo"))
            else -> {
                val (photo, source) = located
                renditions.ensure(photo.id, source, photo.orientation)
                streamFile(renditions.path(photo.id, rendition), "image/jpeg", IMMUTABLE)
            }
        }
    }

    fun original(ctx: RouteContext, user: AuthenticatedUser): StreamResult {
        val (photo, source) = locate(ctx, user) ?: return StreamFailed(Err(404, "NOT_FOUND", "No such photo"))
        val type = if (photo.filename.substringAfterLast('.').lowercase() == "png") "image/png" else "image/jpeg"
        return streamFile(source, type, mapOf("Cache-Control" to "private, no-cache"))
    }

    private fun locate(ctx: RouteContext, user: AuthenticatedUser): Pair<PhotoRow, Path>? {
        val owned = ctx.uuidParam("photoId")?.let { photos.findOwned(it, user.id) } ?: return null
        val source = resolveChild(userRoot(dataRoot, user.username), owned.projectName, ::isValidProjectName)
            ?.let(::originalsDir)
            ?.let { resolveChild(it, owned.photo.filename, ::isValidPhotoFilename) }
            ?.takeIf { Files.isRegularFile(it) }
            ?: return null
        return owned.photo to source
    }

    private fun readHead(path: Path): ByteArray = Files.newInputStream(path).use { it.readNBytes(EXIF_SCAN_BYTES) }

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
