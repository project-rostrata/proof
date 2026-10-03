package proof.index

import proof.db.PhotoRow
import proof.db.ProjectRow
import java.time.Instant

// The pure half of reconciliation: what's on disk vs what's indexed, decided with no I/O, so it's
// unit-tested directly (test/ReconcilePlanTest.kt). Reconciler.kt does the reading and applying.
// Times are at the index's precision (fs/FileTimes.kt), so "unchanged" compares equal.

// One original in a project's originals/, and what's beside it.
data class DiskPhoto(
    val filename: String,
    val sizeBytes: Long,
    val mtime: Instant,
    val sidecarMtime: Instant?, // originals/<filename>.xmp, when there is one
    val editMtime: Instant?, //    the render in edits/, when it and its recipe are both there
)

data class PhotoChanges(
    val added: List<DiskPhoto>, //                          on disk, not indexed
    val removed: List<PhotoRow>, //                         indexed, gone from disk
    val originalChanged: List<Pair<PhotoRow, DiskPhoto>>, // replaced in place (size or mtime differs)
    val sidecarChanged: List<Pair<PhotoRow, DiskPhoto>>, //  written, added, or deleted by another tool
    val editChanged: List<Pair<PhotoRow, DiskPhoto>>, //     render or recipe added, replaced, or deleted
) {
    val isEmpty: Boolean get() = listOf(added, removed, originalChanged, sidecarChanged, editChanged).all { it.isEmpty() }
}

fun planPhotos(onDisk: List<DiskPhoto>, indexed: List<PhotoRow>): PhotoChanges {
    val indexedByName = indexed.associateBy { it.filename }
    val diskNames = onDisk.map { it.filename }.toSet()
    val present = onDisk.mapNotNull { disk -> indexedByName[disk.filename]?.let { it to disk } }
    return PhotoChanges(
        added = onDisk.filter { it.filename !in indexedByName },
        removed = indexed.filter { it.filename !in diskNames },
        originalChanged = present.filter { (row, disk) -> row.sizeBytes != disk.sizeBytes || row.mtime != disk.mtime },
        sidecarChanged = present.filter { (row, disk) -> row.sidecarMtime != disk.sidecarMtime },
        editChanged = present.filter { (row, disk) -> (if (row.hasEdit) row.editMtime else null) != disk.editMtime },
    )
}

data class ProjectChanges(val added: List<String>, val removed: List<ProjectRow>)

// A project directory renamed outside the app shows up as one removed and one added. Nothing is
// lost: cull state is in the sidecars and edits are in edits/, and both are read back in.
fun planProjects(onDisk: Set<String>, indexed: List<ProjectRow>): ProjectChanges {
    val indexedNames = indexed.map { it.name }.toSet()
    return ProjectChanges(
        added = onDisk.filter { it !in indexedNames }.sorted(),
        removed = indexed.filter { it.name !in onDisk },
    )
}
