import proof.api.FileStream
import proof.api.StaticFileHandler
import proof.api.StreamFailed
import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.assertEquals
import kotlin.test.assertIs

private fun withFrontend(block: (Path) -> Unit) {
    val root = Files.createTempDirectory("proof-static-test")
    try {
        Files.writeString(root.resolve("index.html"), "<!doctype html>")
        Files.createDirectories(root.resolve("src"))
        Files.writeString(root.resolve("src/app.js"), "export {}")
        block(root)
    } finally {
        Files.walk(root).sorted(Comparator.reverseOrder()).forEach { Files.delete(it) }
    }
}

fun testRootServesIndexHtml() = withFrontend { root ->
    val result = StaticFileHandler(root).serve("/")

    assertIs<FileStream>(result)
    assertEquals("text/html; charset=utf-8", result.contentType)
    val body = ByteArrayOutputStream().also { result.write(it) }.toString(Charsets.UTF_8)
    assertEquals("<!doctype html>", body)
}

// Browsers refuse <script type="module"> unless it's served as JavaScript.
fun testModulesServedAsJavascript() = withFrontend { root ->
    val result = StaticFileHandler(root).serve("/src/app.js")

    assertIs<FileStream>(result)
    assertEquals("text/javascript; charset=utf-8", result.contentType)
}

fun testMissingFileIs404() = withFrontend { root ->
    val result = StaticFileHandler(root).serve("/nope.js")

    assertIs<StreamFailed>(result)
    assertEquals(404, result.err.status)
}

fun testTraversalIs403() = withFrontend { root ->
    val result = StaticFileHandler(root).serve("/../../etc/passwd")

    assertIs<StreamFailed>(result)
    assertEquals(403, result.err.status)
}
