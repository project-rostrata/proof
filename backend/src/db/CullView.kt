package proof.db

// The cull views a project can be filtered to. Each is a fixed SQL predicate (never built from
// client input) over the `photos ph` alias.
enum class CullView(val id: String, val label: String, val where: String) {
    ALL("all", "All", "true"),
    PICKS("picks", "Picks", "ph.flag = 'pick'"),
    UNRATED("unrated", "Unrated", "ph.flag = 'none' AND ph.rating = 0"),
    REJECTS("rejects", "Rejects", "ph.flag = 'reject'"),
    ;

    companion object {
        fun fromId(id: String?): CullView? = if (id == null) ALL else entries.firstOrNull { it.id == id }
    }
}
