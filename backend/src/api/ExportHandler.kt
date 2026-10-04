package proof.api

import proof.db.CullView
import proof.db.PhotoRepository
import proof.db.PhotoRow
import proof.db.ProjectRepository
import proof.export.exportEntries
import proof.fs.Resolved
import proof.fs.editsDir
import proof.fs.isValidPhotoFilename
import proof.fs.isValidProjectName
import proof.fs.originalsDir
import proof.fs.renderName
import proof.fs.resolveChild
import proof.fs.resolveUnderRoot
import proof.fs.userRoot
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.util.zip.Deflater
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

// GET /api/projects/:projectId/export: the project's picks as one ZIP (V1_PLAN.md Phase 12). Each is
// the saved edit if it has one, otherwise the original, in capture order. Streamed as it's written,
// with no length known up front, so nothing is staged on disk or in memory. Stored without
// compression: JPEGs and PNGs don't shrink, and deflating them would only cost CPU. Zip64 kicks in
// by itself past 4 GB.
class ExportHandler(
    private val projects: ProjectRepository,
    private val photos: PhotoRepository,
    private val dataRoot: Path,
) {
    fun export(ctx: RouteContext, user: AuthenticatedUser): StreamResult {
        val project = ctx.uuidParam("projectId")?.let { projects.findOwned(it, user.id) } ?: return StreamFailed(projectNotFound())
        val dir = resolveChild(userRoot(dataRoot, user.username), project.name, ::isValidProjectName) ?: return StreamFailed(projectNotFound())
        val picks = photos.listForProject(project.id, CullView.PICKS, 0)
        val files = exportEntries(picks) { editFile(dir, it) != null }.mapNotNull { entry ->
            val file = if (entry.fromEdit) editFile(dir, entry.photo) else originalFile(dir, entry.photo)
            file?.let { entry.name to it } // an original gone from disk is left out (reconciliation will drop it)
        }
        if (files.isEmpty()) return StreamFailed(Err(404, "NOTHING_TO_EXPORT", "This project has no picks to export"))
        return FileStream(
            contentType = "application/zip",
            fileName = "${project.name}.zip",
            contentLength = UNKNOWN_LENGTH,
            asAttachment = true,
            headers = mapOf("Cache-Control" to "no-store"),
        ) { output ->
            ZipOutputStream(output).use { zip ->
                zip.setLevel(Deflater.NO_COMPRESSION)
                for ((name, file) in files) {
                    zip.putNextEntry(ZipEntry(name).apply { lastModifiedTime = Files.getLastModifiedTime(file) })
                    Files.newInputStream(file).use { it.copyTo(zip) }
                    zip.closeEntry()
                }
            }
        }
    }

    private fun originalFile(projectDir: Path, photo: PhotoRow): Path? =
        resolveChild(originalsDir(projectDir), photo.filename, ::isValidPhotoFilename)?.takeIf { Files.isRegularFile(it, LinkOption.NOFOLLOW_LINKS) }

    private fun editFile(projectDir: Path, photo: PhotoRow): Path? =
        (resolveUnderRoot(editsDir(projectDir), renderName(photo.filename)) as? Resolved)?.path?.takeIf { Files.isRegularFile(it, LinkOption.NOFOLLOW_LINKS) }
}
