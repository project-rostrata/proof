package proof.export

import proof.db.PhotoRow
import proof.fs.renderName

// One file in a project's export ZIP: the pick's saved edit if it has one, otherwise its original.
data class ExportEntry(val name: String, val photo: PhotoRow, val fromEdit: Boolean)

// Pure, so it's tested directly (test/ExportPlanTest.kt). `editExists` says whether a pick's render
// is really on disk; a missing one falls back to the original rather than leaving the photo out.
// Names are the files' own names (an edit is named by renderName, as in edits/). Two entries can't
// share a name in a ZIP, and in a rare case they could (an edited scan.png and an unedited original
// called scan.png.jpg), so a repeat gets " (2)", " (3)", ... before its extension.
fun exportEntries(picks: List<PhotoRow>, editExists: (PhotoRow) -> Boolean): List<ExportEntry> {
    val used = mutableSetOf<String>()
    return picks.map { photo ->
        val fromEdit = photo.hasEdit && editExists(photo)
        val name = uniqueName(if (fromEdit) renderName(photo.filename) else photo.filename, used)
        ExportEntry(name, photo, fromEdit)
    }
}

private fun uniqueName(name: String, used: MutableSet<String>): String {
    var candidate = name
    var n = 2
    while (!used.add(candidate.lowercase())) {
        val dot = name.lastIndexOf('.')
        candidate = if (dot > 0) "${name.substring(0, dot)} ($n)${name.substring(dot)}" else "$name ($n)"
        n++
    }
    return candidate
}
