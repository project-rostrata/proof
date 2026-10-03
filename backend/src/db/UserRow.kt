package proof.db

import java.time.Instant
import java.util.UUID

data class UserRow(val id: UUID, val username: String, val passwordHash: String, val createdAt: Instant)
