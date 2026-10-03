package proof.index

import java.util.UUID

// The one locking scheme for every change that touches both the disk and the index, so the request
// handlers and reconciliation can't interleave (docs/decisions.md, Phase 6):
//   - user locks guard a user's set of projects: create, rename, delete, and reconciling the set;
//   - project locks guard a project's photos: upload, cull (the sidecar's read-modify-write), edit
//     save and revert, and reconciling the project.
// When both are needed, take the user lock first. Locks are striped, so memory doesn't grow with
// the number of users or projects, and each hold is short: slow work (receiving an upload, hashing
// a new original) happens before the lock is taken.
class Locks {
    @PublishedApi internal val userStripes = Array(16) { Any() }
    @PublishedApi internal val projectStripes = Array(64) { Any() }

    inline fun <T> user(id: UUID, block: () -> T): T = synchronized(stripe(userStripes, id)) { block() }

    inline fun <T> project(id: UUID, block: () -> T): T = synchronized(stripe(projectStripes, id)) { block() }

    @PublishedApi internal fun stripe(stripes: Array<Any>, id: UUID): Any = stripes[(id.hashCode() and Int.MAX_VALUE) % stripes.size]
}
