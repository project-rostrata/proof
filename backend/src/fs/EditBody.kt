package proof.fs

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import proof.image.ImageType
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.Path

// A saved edit arrives as one request, so the render and its recipe are written together:
//   [4 bytes: recipe length, big-endian][recipe JSON, UTF-8][the rendered JPEG]
// One frame instead of multipart/form-data: there's no parser to hand-write, and nothing to get
// subtly wrong.
const val MAX_RECIPE_BYTES = 256 * 1024

sealed class EditBody {
    data class Parsed(val recipe: String, val recipeVersion: Int, val render: Received.File) : EditBody()
    data object TooLarge : EditBody()
    data class Malformed(val reason: String) : EditBody()
}

// The server treats the recipe as opaque (AGENTS.md "Images on the server"). It only checks that
// it's a JSON object with an integer `version` and a `stack` array, and reads the version for the
// index.
fun recipeVersionOf(text: String): Int? {
    val root = runCatching { Json.parseToJsonElement(text) }.getOrNull() as? JsonObject ?: return null
    val version = (root["version"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull ?: return null
    if (version < 1 || root["stack"] !is JsonArray) return null
    return version
}

fun receiveEdit(body: InputStream, tmpDir: Path, maxRenderBytes: Long): EditBody {
    val header = body.readNBytes(4)
    if (header.size < 4) return EditBody.Malformed("missing recipe length")
    val length = ByteBuffer.wrap(header).int
    if (length <= 0) return EditBody.Malformed("bad recipe length")
    if (length > MAX_RECIPE_BYTES) return EditBody.TooLarge
    val recipeBytes = body.readNBytes(length)
    if (recipeBytes.size < length) return EditBody.Malformed("recipe cut short")
    val recipe = recipeBytes.decodeToString()
    val version = recipeVersionOf(recipe) ?: return EditBody.Malformed("the recipe isn't a proof recipe")
    return when (val render = receiveUpload(body, tmpDir, maxRenderBytes)) {
        is Received.File -> {
            if (render.type != ImageType.JPEG) {
                Files.deleteIfExists(render.path)
                EditBody.Malformed("the render must be a JPEG")
            } else {
                EditBody.Parsed(recipe, version, render)
            }
        }
        Received.TooLarge -> EditBody.TooLarge
        Received.NotAnImage -> EditBody.Malformed("the render isn't a JPEG")
    }
}
