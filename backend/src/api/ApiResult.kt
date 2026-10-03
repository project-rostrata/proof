package proof.api

import kotlinx.serialization.Serializable

sealed class ApiResult<out T>
data class Ok<T>(val value: T) : ApiResult<T>()
data class Err(val status: Int, val code: String, val message: String) : ApiResult<Nothing>()

@Serializable
data class ErrorBody(val code: String, val message: String)

@Serializable
data class ErrorEnvelope(val error: ErrorBody)
