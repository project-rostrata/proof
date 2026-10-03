package proof.db

import java.time.Instant
import java.util.UUID

data class ProjectRow(val id: UUID, val ownerId: UUID, val name: String, val createdAt: Instant, val updatedAt: Instant)

// A project row plus the aggregates the project list shows.
data class ProjectSummaryRow(val project: ProjectRow, val photoCount: Int, val coverPhotoId: UUID?, val coverVersion: Instant?)
