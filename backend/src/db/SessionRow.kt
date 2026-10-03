package proof.db

import java.time.Instant
import java.util.UUID

data class SessionRow(val id: UUID, val userId: UUID, val createdAt: Instant, val expiresAt: Instant)
