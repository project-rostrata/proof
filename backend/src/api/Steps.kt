package proof.api

import kotlinx.serialization.Serializable
import proof.db.StepCounts

// The four steps of a project's workflow, Upload · Cull · Edit · Export (docs/decisions.md,
// 2026-10-04). Steps are guided, never locked: every step can be opened at any time, and these only
// say how far each one has got, and which to open first. All derived from the photos' own state.

@Serializable
data class ApiStep(val id: String, val label: String, val done: Boolean, val summary: String)

// Raw counts too, for the UI's flow decisions (which button is primary, where a pass starts).
@Serializable
data class ApiStepCounts(val total: Int, val picked: Int, val rejected: Int, val undecided: Int, val editedPicks: Int)

@Serializable
data class ApiSteps(val steps: List<ApiStep>, val suggested: String, val counts: ApiStepCounts)

fun StepCounts.toApi(): ApiSteps = ApiSteps(
    steps = listOf(
        ApiStep("upload", "Upload", done = total > 0, summary = if (total == 0) "No photos yet" else photoCountDisplay(total)),
        ApiStep("cull", "Cull", done = total > 0 && undecided == 0, summary = cullSummary()),
        ApiStep("edit", "Edit", done = picked > 0 && editedPicks == picked, summary = if (picked == 0) "No picks yet" else "$editedPicks of $picked edited"),
        ApiStep("export", "Export", done = false, summary = if (picked == 0) "No picks yet" else photoCountDisplay(picked)),
    ),
    // Where a project opens: the first step with something left to do. Export is never suggested.
    suggested = when {
        total == 0 -> "upload"
        undecided > 0 -> "cull"
        else -> "edit"
    },
    counts = ApiStepCounts(total, picked, rejected, undecided, editedPicks),
)

private fun StepCounts.cullSummary(): String = when {
    total == 0 -> "Nothing to cull"
    picked + rejected == 0 -> "$undecided to cull"
    undecided == 0 -> "$picked picked · $rejected rejected"
    else -> "$picked picked · $rejected rejected · $undecided left"
}
