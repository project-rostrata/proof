package proof.auth

data class AuthConfig(val sessionDurationHours: Long, val secureCookies: Boolean)
