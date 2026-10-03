package proof.api

import proof.fs.fileMtime
import proof.index.Locks
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import proof.db.PhotoRepository
import proof.fs.EditBody
import proof.fs.makeShareable
import proof.fs.receiveEdit
import proof.fs.recipeVersionOf
import proof.fs.renderName
import proof.fs.tmpRoot
import proof.image.JpegExif
import proof.image.RenditionGroup
import proof.image.Renditions
import proof.image.probeSize
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.concurrent.ExecutorService
import java.util.logging.Level
import java.util.logging.Logger

private const val EXIF_SCAN_BYTES = 1 shl 20

// Saved edits (V1_PLAN.md Phase 11): the browser's full-resolution render plus its recipe. The
// files in edits/ are the truth, written atomically, and the index follows. The recipe stays
// opaque here: it's stored and handed back unchanged.
class EditsHandler(
    private val photos: PhotoRepository,
    private val locator: PhotoLocator,
    private val renditions: Renditions,
    private val renditionExecutor: ExecutorService,
    private val dataRoot: Path,
    private val maxUploadBytes: Long,
    private val locks: Locks,
) {
    private val logger = Logger.getLogger(EditsHandler::class.qualifiedName)

    // GET /api/photos/:photoId/edit -> {"editVersion": "...", "recipe": {...}}, to reopen an edit.
    fun get(ctx: RouteContext, user: AuthenticatedUser): ApiResult<String> {
        val located = locator.locate(ctx, user) ?: return Err(404, "NOT_FOUND", "No such photo")
        if (!located.photo.hasEdit || !Files.isRegularFile(located.recipe)) return Err(404, "NO_EDIT", "This photo hasn't been edited")
        val text = Files.readString(located.recipe)
        if (recipeVersionOf(text) == null) return Err(409, "RECIPE_UNREADABLE", "The saved recipe for ${located.photo.filename} couldn't be read")
        val body = buildJsonObject {
            put("editVersion", editVersion(located.photo.editMtime))
            put("recipe", Json.parseToJsonElement(text))
        }
        return Ok(body.toString())
    }

    // PUT /api/photos/:photoId/edit?base=<editVersion the editor started from, or "none">, with the
    // framed body (fs/EditBody.kt). Returns the updated photo.
    fun put(ctx: RouteContext, user: AuthenticatedUser): ApiResult<String> {
        val located = locator.locate(ctx, user) ?: return Err(404, "NOT_FOUND", "No such photo")
        val photo = located.photo
        // Optimistic concurrency: a save must start from the edit that's on disk now, so a stale tab
        // can't silently overwrite a newer edit.
        val base = ctx.query["base"] ?: return Err(400, "INVALID_INPUT", "base is required")
        if (base != editVersion(photo.editMtime)) return editChanged()
        // Two originals must never share a render file (scan.png and scan.png.jpg would).
        val clash = photos.filenamesInProject(photo.projectId).firstOrNull { it != photo.filename && renderName(it) == renderName(photo.filename) }
        if (clash != null) return Err(409, "RENDER_NAME_TAKEN", "Can't save: ${photo.filename} and $clash would share the edited file ${renderName(photo.filename)}")

        val parsed = when (val body = receiveEdit(ctx.exchange.requestBody, tmpRoot(dataRoot), maxUploadBytes)) {
            is EditBody.Parsed -> body
            EditBody.TooLarge -> return Err(413, "TOO_LARGE", "The edited photo is larger than ${fileSizeDisplay(maxUploadBytes)}")
            is EditBody.Malformed -> return Err(400, "INVALID_BODY", body.reason)
        }
        val renderTmp = parsed.render.path
        val recipeTmp = Files.createTempFile(located.edits, ".recipe-", ".tmp")
        try {
            if (probeSize(renderTmp) == null) return Err(400, "UNREADABLE_IMAGE", "The edited photo couldn't be decoded")
            // canvas.toBlob() writes no metadata: put the original's EXIF back, now upright.
            val exif = Files.newInputStream(located.original).use { it.readNBytes(EXIF_SCAN_BYTES) }.let(JpegExif::exifSegment)
            if (exif != null) {
                val spliced = JpegExif.splice(Files.readAllBytes(renderTmp), JpegExif.withOrientation(exif, 1))
                    ?: return Err(400, "UNREADABLE_IMAGE", "The edited photo isn't a well-formed JPEG")
                Files.write(renderTmp, spliced)
            }
            Files.writeString(recipeTmp, parsed.recipe)
            // The commit is under the project lock, and the base is checked again there: two tabs
            // saving at once can't both pass the check above, and reconciliation can't read a
            // half-written pair.
            val conflict = locks.project(photo.projectId) {
                if (base != editVersion(photos.findById(photo.id)?.editMtime)) return@project true
                Files.move(renderTmp, located.render, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
                Files.move(recipeTmp, located.recipe, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
                makeShareable(located.render)
                makeShareable(located.recipe)
                photos.updateEdit(photo.id, fileMtime(located.render), parsed.recipeVersion)
                false
            }
            if (conflict) return editChanged()
        } finally {
            Files.deleteIfExists(renderTmp)
            Files.deleteIfExists(recipeTmp)
        }
        regenerateDisplay(photo.id, located.render, 1)
        return Ok(Json.encodeToString(photos.findById(photo.id)!!.toApi()))
    }

    // DELETE /api/photos/:photoId/edit: revert to the original. The render and recipe are deleted.
    fun delete(ctx: RouteContext, user: AuthenticatedUser): ApiResult<String> {
        val located = locator.locate(ctx, user) ?: return Err(404, "NOT_FOUND", "No such photo")
        locks.project(located.photo.projectId) {
            Files.deleteIfExists(located.render)
            Files.deleteIfExists(located.recipe)
            photos.clearEdit(located.photo.id)
        }
        regenerateDisplay(located.photo.id, located.original, located.photo.orientation)
        return Ok(Json.encodeToString(photos.findById(located.photo.id)!!.toApi()))
    }

    private fun editChanged(): Err =
        Err(409, "EDIT_CHANGED", "This photo's edit changed since you opened it. Reopen the editor to continue from the latest version")

    private fun regenerateDisplay(photoId: java.util.UUID, source: Path, orientation: Int) {
        renditions.invalidateDisplay(photoId)
        renditionExecutor.submit {
            try {
                renditions.ensure(photoId, RenditionGroup.DISPLAY, source, orientation)
            } catch (e: Exception) {
                logger.log(Level.WARNING, "rendition regeneration failed for photo $photoId", e)
            }
        }
    }
}

fun editVersion(editMtime: java.time.Instant?): String = editMtime?.toEpochMilli()?.toString() ?: "none"
