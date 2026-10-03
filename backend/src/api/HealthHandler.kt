package proof.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
private data class HealthResponse(val status: String)

fun healthHandler(ctx: RouteContext): ApiResult<String> =
    Ok(Json.encodeToString(HealthResponse("ok")))
