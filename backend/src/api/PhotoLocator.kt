package proof.api

import proof.db.PhotoRepository
import proof.db.PhotoRow
import proof.fs.Resolved
import proof.fs.editsDir
import proof.fs.isValidPhotoFilename
import proof.fs.isValidProjectName
import proof.fs.originalsDir
import proof.fs.recipeName
import proof.fs.renderName
import proof.fs.resolveChild
import proof.fs.resolveUnderRoot
import proof.fs.userRoot
import java.nio.file.Files
import java.nio.file.Path

// A photo the user owns and where its files are. Paths are built from stored names, but still go
// through path safety (AGENTS.md "Security rules").
data class LocatedPhoto(val photo: PhotoRow, val original: Path, val edits: Path, val render: Path, val recipe: Path)

class PhotoLocator(private val photos: PhotoRepository, private val dataRoot: Path) {
    fun locate(ctx: RouteContext, user: AuthenticatedUser): LocatedPhoto? {
        val owned = ctx.uuidParam("photoId")?.let { photos.findOwned(it, user.id) } ?: return null
        val project = resolveChild(userRoot(dataRoot, user.username), owned.projectName, ::isValidProjectName) ?: return null
        val original = resolveChild(originalsDir(project), owned.photo.filename, ::isValidPhotoFilename)
            ?.takeIf { Files.isRegularFile(it) } ?: return null
        val edits = editsDir(project)
        Files.createDirectories(edits)
        val render = (resolveUnderRoot(edits, renderName(owned.photo.filename)) as? Resolved)?.path ?: return null
        val recipe = (resolveUnderRoot(edits, recipeName(owned.photo.filename)) as? Resolved)?.path ?: return null
        return LocatedPhoto(owned.photo, original, edits, render, recipe)
    }
}
