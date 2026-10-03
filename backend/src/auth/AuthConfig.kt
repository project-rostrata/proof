package proof.auth

// allowRegistration: whether anyone can create an account. The first account can always be
// created (someone has to), so a fresh install works with the default of false
// (PROOF_ALLOW_REGISTRATION, docs/deployment.md).
data class AuthConfig(val sessionDurationHours: Long, val secureCookies: Boolean, val allowRegistration: Boolean = false)
