import proof.fs.EditBody
import proof.fs.receiveEdit
import proof.fs.recipeName
import proof.fs.recipeVersionOf
import proof.fs.renderName
import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.nio.file.Files
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

private fun frame(recipe: String, render: ByteArray): ByteArray {
    val r = recipe.toByteArray()
    return ByteBuffer.allocate(4).putInt(r.size).array() + r + render
}

private fun withTmp(block: (java.nio.file.Path) -> Unit) {
    val dir = Files.createTempDirectory("proof-edit-test")
    try { block(dir) } finally { Files.walk(dir).sorted(Comparator.reverseOrder()).forEach { Files.delete(it) } }
}

private val RENDER = jpegWithExif(quadrants(32, 32), null)

fun testParsesRecipeAndRender() = withTmp { dir ->
    val recipe = """{"version":1,"stack":[{"tool":"tune","params":{"brightness":12}}]}"""
    val parsed = receiveEdit(ByteArrayInputStream(frame(recipe, RENDER)), dir, 1_000_000)
    assertIs<EditBody.Parsed>(parsed)
    assertEquals(recipe, parsed.recipe)
    assertEquals(1, parsed.recipeVersion)
    assertEquals(RENDER.size.toLong(), parsed.render.sizeBytes)
}

fun testRejectsRecipesThatArentRecipes() = withTmp { dir ->
    for (bad in listOf("[]", "{}", """{"version":"1","stack":[]}""", """{"version":0,"stack":[]}""", """{"version":1}""", "not json")) {
        assertIs<EditBody.Malformed>(receiveEdit(ByteArrayInputStream(frame(bad, RENDER)), dir, 1_000_000), bad)
    }
    assertEquals(0L, Files.list(dir).use { it.count() })
}

fun testRejectsNonJpegRendersAndTruncatedFrames() = withTmp { dir ->
    val recipe = """{"version":1,"stack":[]}"""
    assertIs<EditBody.Malformed>(receiveEdit(ByteArrayInputStream(frame(recipe, pngBytes(quadrants(8, 8)))), dir, 1_000_000))
    assertIs<EditBody.Malformed>(receiveEdit(ByteArrayInputStream(byteArrayOf(0, 0)), dir, 1_000_000))
    assertIs<EditBody.Malformed>(receiveEdit(ByteArrayInputStream(ByteBuffer.allocate(4).putInt(100).array() + "{}".toByteArray()), dir, 1_000_000))
    assertIs<EditBody.TooLarge>(receiveEdit(ByteArrayInputStream(ByteBuffer.allocate(4).putInt(10_000_000).array()), dir, 1_000_000))
    assertIs<EditBody.TooLarge>(receiveEdit(ByteArrayInputStream(frame(recipe, RENDER)), dir, 10))
    assertEquals(0L, Files.list(dir).use { it.count() })
}

fun testRecipeVersionIsReadAndNothingElse() {
    assertEquals(3, recipeVersionOf("""{"version":3,"stack":[],"anything":{"else":true}}"""))
    assertNull(recipeVersionOf("""{"version":3.5,"stack":[]}"""))
}

fun testEditFilesAreNamedAfterTheOriginal() {
    assertEquals("IMG_0001.jpg", renderName("IMG_0001.jpg"))
    assertEquals("DSC_1.JPEG", renderName("DSC_1.JPEG"))
    assertEquals("scan.png.jpg", renderName("scan.png"))
    assertEquals("scan.png.recipe.json", recipeName("scan.png"))
}
