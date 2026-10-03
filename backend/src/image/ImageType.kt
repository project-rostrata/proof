package proof.image

enum class ImageType(val extensions: Set<String>) {
    JPEG(setOf("jpg", "jpeg")),
    PNG(setOf("png")),
}

// File type from magic bytes, never from the extension or a client-supplied Content-Type
// (AGENTS.md "Images on the server").
fun sniff(head: ByteArray): ImageType? = when {
    head.size >= 3 && head[0] == 0xFF.toByte() && head[1] == 0xD8.toByte() && head[2] == 0xFF.toByte() -> ImageType.JPEG
    head.size >= 8 && head.copyOfRange(0, 8).contentEquals(PNG_SIGNATURE) -> ImageType.PNG
    else -> null
}

private val PNG_SIGNATURE = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
