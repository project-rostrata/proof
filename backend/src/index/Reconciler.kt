package proof.index

import proof.db.NewPhoto
import proof.db.PhotoRepository
import proof.db.PhotoRow
import proof.db.ProjectRepository
import proof.db.ProjectRow
import proof.db.UserRepository
import proof.fs.editsDir
import proof.fs.isValidPhotoFilename
import proof.fs.isValidProjectName
import proof.fs.originalsDir
import proof.fs.recipeName
import proof.fs.recipeVersionOf
import proof.fs.renderName
import proof.fs.resolveChild
import proof.fs.sha256Of
import proof.fs.truncateToIndex
import proof.fs.userRoot
import proof.image.FLAG_NONE
import proof.image.OriginalFacts
import proof.image.Renditions
import proof.image.SidecarUnreadable
import proof.image.Xmp
import proof.image.readOriginalFacts
import proof.image.sniff
import java.io.IOException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.attribute.BasicFileAttributes
import java.time.Instant
import java.util.UUID
import java.util.logging.Level
import java.util.logging.Logger

// Reconciliation (V1_PLAN.md Phase 6): brings the index back in line with the files, which are the
// truth. It notices projects and photos added, renamed, replaced, or deleted outside the app (over
// SMB, say), sidecars changed by other tools, and edits/ files added or removed by hand.
//
// It runs in three places, all through this class:
//   - opening the projects list reconciles the user's set of projects (one directory listing);
//   - opening a project reconciles its photos (a directory listing and a stat per file);
//   - a periodic backstop pass does every user's everything (Main.kt).
// So there's no "refresh" button: reloading the page is the refresh.
//
// The planning is pure (ReconcilePlan.kt). This is the I/O around it. Hashing and decoding new or
// replaced originals is the only slow part, and it happens *before* the project lock is taken. Under
// the lock the disk is listed again and re-planned, and work prepared for a file is used only if the
// file still has the size and mtime it was read at. So an upload or a cull never waits on hashing,
// and nothing is applied from a stale look at the disk.
class Reconciler(
    private val dataRoot: Path,
    private val users: UserRepository,
    private val projects: ProjectRepository,
    private val photos: PhotoRepository,
    private val renditions: Renditions,
    private val locks: Locks,
) {
    private val logger = Logger.getLogger(Reconciler::class.qualifiedName)

    // The backstop: every user, every project. One user's failure doesn't stop the others.
    fun reconcileEveryone() {
        for (user in users.listAll()) {
            try {
                reconcileProjectSet(user.id, user.username)
                for (project in projects.listForOwner(user.id)) reconcileProject(user.username, project)
            } catch (e: Exception) {
                logger.log(Level.WARNING, "reconciliation failed for user ${user.username}", e)
            }
        }
    }

    // The user's project directories vs their project rows. A project that's new on disk has its
    // photos indexed straight away, so it shows up in the list with its photos and cover.
    fun reconcileProjectSet(userId: UUID, username: String) {
        val root = userRoot(dataRoot, username)
        // Unmounted storage, or a user whose folder was never created: never mistake that for
        // "every project was deleted". Only a folder that's really there is compared with the index.
        if (!Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) return
        val added = locks.user(userId) {
            val changes = planProjects(projectDirectories(root), projects.listForOwner(userId))
            for (project in changes.removed) {
                locks.project(project.id) { removeProject(project) }
                logger.info("reconciliation: project \"${project.name}\" is gone from disk, removed from ${username}'s index")
            }
            changes.added.map { name ->
                logger.info("reconciliation: found project \"$name\" on disk for $username")
                projects.create(userId, name)
            }
        }
        for (project in added) reconcileProject(username, project)
    }

    fun reconcileProject(username: String, project: ProjectRow) {
        val dir = resolveChild(userRoot(dataRoot, username), project.name, ::isValidProjectName) ?: return
        if (!Files.isDirectory(dir, LinkOption.NOFOLLOW_LINKS)) return // the project-set pass deals with it
        val prepared = prepare(dir, planPhotos(scan(dir), photos.listAll(project.id)))
        locks.project(project.id) {
            // Deleted while the slow part ran: there's nothing left to reconcile.
            if (projects.findOwned(project.id, project.ownerId) == null) return
            val changes = planPhotos(scan(dir), photos.listAll(project.id))
            if (changes.isEmpty) return
            // Counted from what was applied, not planned: a file that isn't a photo stays "added" in
            // every plan but is never indexed, and mustn't log (or touch the project) every pass.
            val applied = apply(project, dir, changes, prepared)
            if (applied.total == 0) return
            projects.touch(project.id)
            logger.info("reconciliation: \"${project.name}\" (${username}): $applied")
        }
    }

    // ---- reading the disk ----

    // Real directories with valid project names. Symlinks are never followed: nothing reached
    // through a link is indexed, so a link can't lead the index outside the user's folder.
    private fun projectDirectories(root: Path): Set<String> =
        Files.newDirectoryStream(root).use { entries ->
            entries.filter { Files.isDirectory(it, LinkOption.NOFOLLOW_LINKS) }.map { it.fileName.toString() }.filter(::isValidProjectName).toSet()
        }

    // Every original in originals/: regular files (not links) with a photo extension and a valid
    // name. Hidden files, including proof's own temp files, never qualify.
    private fun scan(projectDir: Path): List<DiskPhoto> {
        val originals = originalsDir(projectDir)
        if (!Files.isDirectory(originals, LinkOption.NOFOLLOW_LINKS)) return emptyList()
        val edits = editsDir(projectDir)
        return Files.newDirectoryStream(originals).use { entries ->
            entries.mapNotNull { path ->
                val name = path.fileName.toString()
                if (!isValidPhotoFilename(name)) return@mapNotNull null
                val attrs = attributesOrNull(path)?.takeIf { it.isRegularFile } ?: return@mapNotNull null
                DiskPhoto(
                    filename = name,
                    sizeBytes = attrs.size(),
                    mtime = truncateToIndex(attrs.lastModifiedTime().toInstant()),
                    sidecarMtime = regularFileMtime(Xmp.sidecarFor(path)),
                    editMtime = regularFileMtime(edits.resolve(recipeName(name)))?.let { regularFileMtime(edits.resolve(renderName(name))) },
                )
            }
        }
    }

    // ---- the slow part, outside the lock ----

    private data class Prepared(val sizeBytes: Long, val mtime: Instant, val sha256: String, val facts: OriginalFacts)

    // Hash and read every original that's new or replaced. A file that isn't an image (by its magic
    // bytes), whose bytes don't match its extension, or that can't be decoded, isn't indexed. It's
    // logged at FINE, not WARNING, because every pass would log it again.
    private fun prepare(projectDir: Path, changes: PhotoChanges): Map<String, Prepared> {
        val needed = changes.added + changes.originalChanged.map { it.second }
        return needed.mapNotNull { disk ->
            val file = originalsDir(projectDir).resolve(disk.filename)
            try {
                val type = sniff(Files.newInputStream(file).use { it.readNBytes(16) })
                val extension = disk.filename.substringAfterLast('.').lowercase()
                if (type == null || extension !in type.extensions) {
                    logger.fine("reconciliation: skipping ${disk.filename}: not a JPEG or PNG matching its extension")
                    return@mapNotNull null
                }
                val facts = readOriginalFacts(file) ?: run {
                    logger.fine("reconciliation: skipping ${disk.filename}: couldn't be decoded")
                    return@mapNotNull null
                }
                disk.filename to Prepared(disk.sizeBytes, disk.mtime, sha256Of(file), facts)
            } catch (e: IOException) {
                logger.log(Level.FINE, "reconciliation: skipping ${disk.filename}", e) // vanished or unreadable mid-pass
                null
            }
        }.toMap()
    }

    // ---- applying, under the project lock ----

    private data class Applied(val added: Int, val removed: Int, val replaced: Int, val sidecars: Int, val edits: Int) {
        val total get() = added + removed + replaced + sidecars + edits
        override fun toString() = "$added added, $removed removed, $replaced replaced, $sidecars sidecars and $edits edits re-read"
    }

    private fun apply(project: ProjectRow, projectDir: Path, changes: PhotoChanges, prepared: Map<String, Prepared>): Applied {
        // Prepared work counts only if the file is still exactly what was read. Anything else waits
        // for the next pass.
        fun preparedFor(disk: DiskPhoto) = prepared[disk.filename]?.takeIf { it.sizeBytes == disk.sizeBytes && it.mtime == disk.mtime }

        for (row in changes.removed) {
            photos.delete(row.id)
            dropRenditions(row.id)
        }
        var added = 0
        for (disk in changes.added) {
            val p = preparedFor(disk) ?: continue
            added++
            val row = photos.insert(p.facts.toNewPhoto(project.id, disk.filename, disk.sizeBytes, disk.mtime, p.sha256))
            if (disk.sidecarMtime != null) syncSidecar(row, disk, projectDir)
            if (disk.editMtime != null) syncEdit(row, disk, projectDir)
        }
        var replaced = 0
        for ((row, disk) in changes.originalChanged) {
            val p = preparedFor(disk) ?: continue
            replaced++
            photos.updateOriginal(row.id, p.facts.toNewPhoto(project.id, disk.filename, disk.sizeBytes, disk.mtime, p.sha256))
            dropRenditions(row.id) // regenerated on demand from the new file
        }
        val sidecars = changes.sidecarChanged.count { (row, disk) -> syncSidecar(row, disk, projectDir) }
        for ((row, disk) in changes.editChanged) {
            syncEdit(row, disk, projectDir)
            renditions.invalidateDisplay(row.id) // the grid and loupe show the render when there is one
        }
        return Applied(added, changes.removed.size, replaced, sidecars, changes.editChanged.size)
    }

    // A sidecar that's gone resets the cull state, since the sidecar is the truth. One that can't be
    // parsed is left alone, and so is the index, until it's fixed (Xmp.kt never overwrites it either).
    // Returns whether the index was updated.
    private fun syncSidecar(row: PhotoRow, disk: DiskPhoto, projectDir: Path): Boolean {
        if (disk.sidecarMtime == null) {
            photos.updateCull(row.id, 0, FLAG_NONE, null)
            return true
        }
        return try {
            val state = Xmp.read(Xmp.sidecarFor(originalsDir(projectDir).resolve(disk.filename)))
            photos.updateCull(row.id, state.rating, state.flag, disk.sidecarMtime)
            true
        } catch (e: SidecarUnreadable) {
            logger.fine("reconciliation: ${disk.filename}.xmp couldn't be read: ${e.message}")
            false
        }
    }

    // An edit is a render plus its recipe. The recipe stays opaque (AGENTS.md): only its version is
    // read, and an unreadable one is indexed with no version (reopening it reports the problem).
    private fun syncEdit(row: PhotoRow, disk: DiskPhoto, projectDir: Path) {
        if (disk.editMtime == null) {
            photos.clearEdit(row.id)
            return
        }
        val recipe = editsDir(projectDir).resolve(recipeName(disk.filename))
        val version = try {
            recipeVersionOf(Files.readString(recipe))
        } catch (e: IOException) {
            null
        }
        photos.updateEdit(row.id, disk.editMtime, version)
    }

    // Under both locks (user, then project), so no upload or cull is mid-way into it.
    private fun removeProject(project: ProjectRow) {
        val ids = photos.idsForProject(project.id)
        projects.delete(project.id) // its photos go with it (ON DELETE CASCADE)
        ids.forEach(::dropRenditions)
    }

    private fun dropRenditions(photoId: UUID) {
        try {
            renditions.delete(photoId)
        } catch (e: IOException) {
            logger.log(Level.WARNING, "could not delete cached renditions for photo $photoId", e)
        }
    }

    private fun attributesOrNull(path: Path): BasicFileAttributes? = try {
        Files.readAttributes(path, BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
    } catch (e: IOException) {
        null // gone since it was listed
    }

    private fun regularFileMtime(path: Path): Instant? =
        attributesOrNull(path)?.takeIf { it.isRegularFile }?.let { truncateToIndex(it.lastModifiedTime().toInstant()) }
}

// A photo as the index records it, from the file's own facts. Used by upload and reconciliation.
fun OriginalFacts.toNewPhoto(projectId: UUID, filename: String, sizeBytes: Long, mtime: Instant, sha256: String) = NewPhoto(
    projectId = projectId,
    filename = filename,
    sizeBytes = sizeBytes,
    mtime = mtime,
    contentSha256 = sha256,
    width = width,
    height = height,
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
)
