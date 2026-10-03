package proof.image

import org.w3c.dom.Document
import org.w3c.dom.Element
import org.xml.sax.ErrorHandler
import org.xml.sax.SAXParseException
import proof.fs.makeShareable
import java.io.ByteArrayInputStream
import java.io.StringWriter
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory
import javax.xml.transform.OutputKeys
import javax.xml.transform.TransformerFactory
import javax.xml.transform.dom.DOMSource
import javax.xml.transform.stream.StreamResult

// Cull state as proof models it (PROJECT_BRIEF.md §4): 0-5 stars and a pick/reject flag. The XMP
// sidecar next to the original is the truth.
data class CullState(val rating: Int = 0, val flag: String = FLAG_NONE)

const val FLAG_NONE = "none"
const val FLAG_PICK = "pick"
const val FLAG_REJECT = "reject"
val FLAGS = setOf(FLAG_NONE, FLAG_PICK, FLAG_REJECT)

private const val RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
private const val X_NS = "adobe:ns:meta/"
private const val XMP_NS = "http://ns.adobe.com/xap/1.0/"

// proof's own namespace, for what standard XMP has no field for: the pick flag, and the star
// rating of a rejected photo (whose xmp:Rating has to be -1, see below). The "x-" marks it
// unregistered.
private const val PROOF_NS = "urn:x-proof:xmp:1.0"
private const val XMLNS_NS = "http://www.w3.org/2000/xmlns/"

class SidecarUnreadable(message: String) : Exception(message)

private object QuietErrors : ErrorHandler {
    override fun warning(e: SAXParseException) {}
    override fun error(e: SAXParseException) = throw e
    override fun fatalError(e: SAXParseException) = throw e
}

// Reads and writes `<original>.xmp` sidecars (darktable-style naming, PROJECT_BRIEF.md §5).
//
// darktable keeps its *entire edit history* in that same file. So proof never rewrites a sidecar
// wholesale: it parses the existing document, changes only its own properties, and writes everything
// else back untouched. A sidecar that can't be parsed is never overwritten (SidecarUnreadable),
// because clobbering it could destroy another tool's work.
//
// Mapping, chosen so other tools see the right thing:
//   xmp:Rating   stars 0-5, or -1 when rejected. -1 is the de facto reject value in Lightroom and darktable.
//   proof:Flag   none | pick | reject. Standard XMP has no "pick".
//   proof:Rating the stars, kept even while rejected, so un-rejecting restores them.
// proof has no colour labels, so an xmp:Label set by Lightroom or darktable is left as it is.
object Xmp {
    fun sidecarFor(original: Path): Path = original.resolveSibling("${original.fileName}.xmp")

    fun read(sidecar: Path): CullState {
        if (!Files.exists(sidecar)) return CullState()
        val description = findDescription(parse(Files.readAllBytes(sidecar))) ?: return CullState()
        val proofFlag = property(description, PROOF_NS, "Flag")?.takeIf { it in FLAGS }
        val proofRating = property(description, PROOF_NS, "Rating")?.toIntOrNull()?.takeIf { it in 0..5 }
        val xmpRating = property(description, XMP_NS, "Rating")?.toIntOrNull()
        // Without proof's fields (a sidecar from another tool), fall back to the standard ones.
        val flag = proofFlag ?: if (xmpRating == -1) FLAG_REJECT else FLAG_NONE
        val rating = proofRating ?: xmpRating?.takeIf { it in 0..5 } ?: 0
        return CullState(rating, flag)
    }

    fun write(sidecar: Path, state: CullState) {
        val existing = Files.exists(sidecar)
        val document = if (existing) parse(Files.readAllBytes(sidecar)) else newDocument()
        val description = findDescription(document) ?: addDescription(document)
        setProperty(description, XMP_NS, "xmp", "Rating", (if (state.flag == FLAG_REJECT) -1 else state.rating).toString())
        setProperty(description, PROOF_NS, "proof", "Flag", state.flag)
        setProperty(description, PROOF_NS, "proof", "Rating", state.rating.toString())
        // Only a sidecar proof creates is indented. Re-indenting an existing one stacks new
        // whitespace on top of the whitespace already in it, and the file grows with every write.
        writeAtomically(document, sidecar, indent = !existing)
    }

    private fun parse(bytes: ByteArray): Document = try {
        // The default error handler also prints every parse error to stderr. The exception is enough.
        secureFactory().newDocumentBuilder().apply { setErrorHandler(QuietErrors) }.parse(ByteArrayInputStream(bytes))
    } catch (e: Exception) {
        throw SidecarUnreadable("existing XMP sidecar couldn't be parsed: ${e.message}")
    }

    // XXE-safe (SECURITY.md): no DTDs at all, so no external or recursive entities.
    private fun secureFactory(): DocumentBuilderFactory = DocumentBuilderFactory.newInstance().apply {
        isNamespaceAware = true
        setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
        setFeature("http://xml.org/sax/features/external-general-entities", false)
        setFeature("http://xml.org/sax/features/external-parameter-entities", false)
        setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
        isXIncludeAware = false
        isExpandEntityReferences = false
    }

    private fun newDocument(): Document {
        val document = secureFactory().newDocumentBuilder().newDocument()
        val meta = document.createElementNS(X_NS, "x:xmpmeta")
        meta.setAttributeNS(X_NS, "x:xmptk", "proof")
        meta.appendChild(document.createElementNS(RDF_NS, "rdf:RDF"))
        document.appendChild(meta)
        return document
    }

    private fun findDescription(document: Document): Element? =
        document.getElementsByTagNameNS(RDF_NS, "Description").let { if (it.length > 0) it.item(0) as Element else null }

    private fun addDescription(document: Document): Element {
        val rdf = document.getElementsByTagNameNS(RDF_NS, "RDF").item(0) as? Element
            ?: throw SidecarUnreadable("existing XMP sidecar has no rdf:RDF element")
        val description = document.createElementNS(RDF_NS, "rdf:Description")
        description.setAttributeNS(RDF_NS, "rdf:about", "")
        rdf.appendChild(description)
        return description
    }

    // XMP allows a simple property as an attribute (what darktable and Lightroom write) or as a
    // child element. Both forms are read.
    private fun property(description: Element, ns: String, name: String): String? {
        if (description.hasAttributeNS(ns, name)) return description.getAttributeNS(ns, name).trim()
        val children = description.getElementsByTagNameNS(ns, name)
        return if (children.length > 0) children.item(0).textContent.trim() else null
    }

    // Updates a property in whichever form it already has; new properties become attributes. A
    // null value removes the property.
    private fun setProperty(description: Element, ns: String, prefix: String, name: String, value: String?) {
        val children = description.getElementsByTagNameNS(ns, name)
        if (children.length > 0) {
            val child = children.item(0)
            if (value == null) child.parentNode.removeChild(child) else child.textContent = value
            return
        }
        if (value == null) {
            description.removeAttributeNS(ns, name)
            return
        }
        val existingPrefix = description.lookupPrefix(ns)
        if (existingPrefix == null) {
            // Declare the namespace explicitly rather than relying on the serializer's fix-up.
            description.setAttributeNS(XMLNS_NS, "xmlns:$prefix", ns)
        }
        description.setAttributeNS(ns, "${existingPrefix ?: prefix}:$name", value)
    }

    private fun writeAtomically(document: Document, target: Path, indent: Boolean) {
        val tmp = Files.createTempFile(target.parent, ".${target.fileName}", ".tmp")
        try {
            val transformer = TransformerFactory.newInstance().apply {
                setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "")
                setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "")
            }.newTransformer()
            transformer.setOutputProperty(OutputKeys.ENCODING, "UTF-8")
            transformer.setOutputProperty(OutputKeys.INDENT, if (indent) "yes" else "no")
            // The declaration is written by hand: the line break after it lives outside the document
            // element, so the serializer would drop it on every rewrite of an un-indented file.
            transformer.setOutputProperty(OutputKeys.OMIT_XML_DECLARATION, "yes")
            // Likewise the trailing newline: normalised to exactly one, so output is byte-stable.
            val body = StringWriter().also { transformer.transform(DOMSource(document), StreamResult(it)) }.toString().trimEnd()
            Files.writeString(tmp, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n$body\n")
            Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            makeShareable(target)
        } finally {
            Files.deleteIfExists(tmp)
        }
    }
}
