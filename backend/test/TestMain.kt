import kotlin.system.exitProcess

// Hand-rolled test runner (AGENTS.md "Testing"): calls every zero-arg top-level `test*` function in
// the classes listed here. Add each new test file's compiled class (`<FileName>Kt`) to this list.
private val testClasses = listOf(
    Class.forName("RouterTestKt"),
    Class.forName("PathSafetyTestKt"),
    Class.forName("StaticFileHandlerTestKt"),
    Class.forName("ServerTestKt"),
    Class.forName("MigrationRunnerTestKt"),
    Class.forName("PasswordHasherTestKt"),
    Class.forName("CookiesTestKt"),
    Class.forName("ConnectionPoolTestKt"),
    Class.forName("UserRootTestKt"),
    Class.forName("ExifReaderTestKt"),
    Class.forName("OrientationTestKt"),
    Class.forName("ImageTypeTestKt"),
    Class.forName("RenditionsTestKt"),
    Class.forName("ProjectPathsTestKt"),
    Class.forName("UploadReceiverTestKt"),
    Class.forName("DisplayTestKt"),
    Class.forName("XmpTestKt"),
    Class.forName("JpegExifTestKt"),
    Class.forName("EditBodyTestKt"),
)

fun main() {
    var passed = 0
    var failed = 0

    for (clazz in testClasses) {
        val testMethods = clazz.declaredMethods.filter { it.name.startsWith("test") && it.parameterCount == 0 }
        for (method in testMethods) {
            try {
                method.invoke(null)
                println("PASS ${clazz.simpleName}.${method.name}")
                passed++
            } catch (e: Exception) {
                println("FAIL ${clazz.simpleName}.${method.name}: ${(e.cause ?: e).message}")
                failed++
            }
        }
    }

    println("---")
    println("$passed passed, $failed failed")
    if (failed > 0) exitProcess(1)
}
