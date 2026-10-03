import proof.image.CullState
import proof.image.FLAG_NONE
import proof.image.FLAG_PICK
import proof.image.FLAG_REJECT
import proof.image.SidecarUnreadable
import proof.image.Xmp
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

private fun withSidecar(content: String? = null, block: (Path) -> Unit) {
    val dir = Files.createTempDirectory("proof-xmp-test")
    try {
        val sidecar = Xmp.sidecarFor(dir.resolve("IMG_0001.jpg"))
        if (content != null) Files.writeString(sidecar, content)
        block(sidecar)
    } finally {
        Files.walk(dir).sorted(Comparator.reverseOrder()).forEach { Files.delete(it) }
    }
}

// The shape of a sidecar darktable writes: attributes on rdf:Description plus its full edit
// history as child elements. proof must update its rating and leave everything else intact.
private val DARKTABLE_SIDECAR = """
<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 4.4.0-Exiv2">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
    xmlns:darktable="http://darktable.sf.net/"
    xmp:Rating="2"
    xmpMM:DerivedFrom="IMG_0001.jpg"
    darktable:xmp_version="5"
    darktable:history_end="2">
   <darktable:history>
    <rdf:Seq>
     <rdf:li darktable:operation="exposure" darktable:enabled="1" darktable:params="0000000000000000"/>
     <rdf:li darktable:operation="colorbalancergb" darktable:enabled="1" darktable:params="9a99993e"/>
    </rdf:Seq>
   </darktable:history>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
""".trimStart()

fun testMissingSidecarIsUnrated() = withSidecar { sidecar ->
    assertEquals(CullState(0, FLAG_NONE), Xmp.read(sidecar))
}

fun testSidecarIsNamedAfterTheFullOriginalFilename() {
    assertEquals("IMG_0001.jpg.xmp", Xmp.sidecarFor(Path.of("/p/originals/IMG_0001.jpg")).fileName.toString())
}

fun testWriteThenReadRoundTrips() = withSidecar { sidecar ->
    Xmp.write(sidecar, CullState(4, FLAG_PICK))
    assertEquals(CullState(4, FLAG_PICK), Xmp.read(sidecar))
}

// Rejecting writes the de facto xmp:Rating="-1" so darktable and Lightroom see a reject, but keeps
// the stars in proof's own field so un-rejecting restores them.
fun testRejectKeepsTheStarsForLater() = withSidecar { sidecar ->
    Xmp.write(sidecar, CullState(4, FLAG_REJECT))
    assertTrue(Files.readString(sidecar).contains("xmp:Rating=\"-1\""))
    assertEquals(CullState(4, FLAG_REJECT), Xmp.read(sidecar))

    Xmp.write(sidecar, CullState(4, FLAG_NONE))
    assertTrue(Files.readString(sidecar).contains("xmp:Rating=\"4\""))
}

fun testReadsADarktableSidecarWithoutProofFields() = withSidecar(DARKTABLE_SIDECAR) { sidecar ->
    assertEquals(CullState(2, FLAG_NONE), Xmp.read(sidecar))
}

fun testDarktableRejectIsReadAsAReject() = withSidecar(DARKTABLE_SIDECAR.replace("xmp:Rating=\"2\"", "xmp:Rating=\"-1\"")) { sidecar ->
    assertEquals(CullState(0, FLAG_REJECT), Xmp.read(sidecar))
}

fun testWritingPreservesDarktablesEditHistory() = withSidecar(DARKTABLE_SIDECAR) { sidecar ->
    Xmp.write(sidecar, CullState(5, FLAG_PICK))

    val written = Files.readString(sidecar)
    assertTrue(written.contains("darktable:operation=\"exposure\""), "history entry 1 kept")
    assertTrue(written.contains("darktable:operation=\"colorbalancergb\""), "history entry 2 kept")
    assertTrue(written.contains("darktable:params=\"9a99993e\""), "params kept byte-for-byte")
    assertTrue(written.contains("darktable:history_end=\"2\""))
    assertTrue(written.contains("xmpMM:DerivedFrom=\"IMG_0001.jpg\""))
    assertTrue(written.contains("xmp:Rating=\"5\""))
    assertEquals(1, Regex("xmp:Rating=").findAll(written).count(), "no duplicate rating")
    assertEquals(CullState(5, FLAG_PICK), Xmp.read(sidecar))
}

// XMP also allows properties as child elements. Those are updated in place, not duplicated as an
// attribute.
fun testElementFormPropertiesAreUpdatedInPlace() = withSidecar(
    DARKTABLE_SIDECAR.replace("    xmp:Rating=\"2\"\n", "").replace("   <darktable:history>", "   <xmp:Rating>3</xmp:Rating>\n   <darktable:history>"),
) { sidecar ->
    assertEquals(3, Xmp.read(sidecar).rating)
    Xmp.write(sidecar, CullState(1, FLAG_NONE))
    val written = Files.readString(sidecar)
    assertTrue(written.contains("<xmp:Rating>1</xmp:Rating>"))
    assertTrue(!written.contains("xmp:Rating=\""))
}

// proof has no colour labels. One set by Lightroom or darktable survives proof's writes.
fun testAnotherToolsColourLabelIsLeftAlone() = withSidecar(DARKTABLE_SIDECAR.replace("xmp:Rating=\"2\"", "xmp:Rating=\"2\"\n    xmp:Label=\"Blue\"")) { sidecar ->
    assertTrue(Files.readString(sidecar).contains("xmp:Label=\"Blue\""))
    Xmp.write(sidecar, CullState(4, FLAG_PICK))
    Xmp.write(sidecar, CullState(0, FLAG_NONE))
    assertTrue(Files.readString(sidecar).contains("xmp:Label=\"Blue\""))
}

// SECURITY.md: no external entities. An unreadable sidecar must never be overwritten, because
// it might be another tool's data.
fun testHostileOrBrokenSidecarsAreRefusedAndLeftAlone() {
    val xxe = """<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x:xmpmeta xmlns:x="adobe:ns:meta/">&e;</x:xmpmeta>"""
    for (content in listOf(xxe, "<x:xmpmeta", "not xml at all")) {
        withSidecar(content) { sidecar ->
            assertFailsWith<SidecarUnreadable> { Xmp.read(sidecar) }
            assertFailsWith<SidecarUnreadable> { Xmp.write(sidecar, CullState(5, FLAG_PICK)) }
            assertEquals(content, Files.readString(sidecar))
        }
    }
}

// Regression: rewriting an existing sidecar must not re-indent it. Re-indenting stacked whitespace
// on every write, so a sidecar (darktable's included) grew with each keypress.
fun testRepeatedWritesAreStable() = withSidecar(DARKTABLE_SIDECAR) { sidecar ->
    Xmp.write(sidecar, CullState(3, FLAG_PICK))
    val first = Files.readString(sidecar)
    Xmp.write(sidecar, CullState(3, FLAG_PICK))
    assertEquals(first, Files.readString(sidecar))
    repeat(20) { Xmp.write(sidecar, CullState(it % 6, FLAG_NONE)) }
    Xmp.write(sidecar, CullState(3, FLAG_PICK))
    assertEquals(first, Files.readString(sidecar))
    // Darktable's own indentation is kept. The serializer does put attributes in alphabetical
    // order, which is the same XML.
    assertTrue(Files.readString(sidecar).contains("\n     <rdf:li "))
    assertTrue(Files.readString(sidecar).startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<x:xmpmeta"))
}

fun testNewSidecarsAreIndentedAndStable() = withSidecar { sidecar ->
    Xmp.write(sidecar, CullState(2, FLAG_NONE))
    val first = Files.readString(sidecar)
    assertTrue(first.lines().size > 3, "pretty-printed")
    Xmp.write(sidecar, CullState(2, FLAG_NONE))
    assertEquals(first, Files.readString(sidecar))
}

// proof's files are meant to be readable by other tools (SMB, darktable), so they must not keep the
// owner-only permissions of the temp file they were written through.
fun testWrittenSidecarsAreReadableByOthers() = withSidecar { sidecar ->
    Xmp.write(sidecar, CullState(1, FLAG_NONE))
    val perms = java.nio.file.attribute.PosixFilePermissions.toString(Files.getPosixFilePermissions(sidecar))
    assertEquals("rw-r--r--", perms)
}
