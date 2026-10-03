package proof.api

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class MeHandler {
    fun handle(ctx: RouteContext, user: AuthenticatedUser): ApiResult<String> =
        Ok(Json.encodeToString(AuthResponse(user.id.toString(), user.username)))
}
