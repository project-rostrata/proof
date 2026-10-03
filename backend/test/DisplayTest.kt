import proof.api.cameraDisplay
import proof.api.captureDisplay
import proof.api.dimensionsDisplay
import proof.api.exposureDisplay
import proof.api.fileSizeDisplay
import proof.api.photoCountDisplay
import proof.api.shutterDisplay
import java.time.LocalDateTime
import kotlin.test.assertEquals
import kotlin.test.assertNull

// Real Make/Model pairs from the Phase 1 spike's test photos, plus common brands.
fun testCameraDisplayNormalisesMakeAndModel() {
    assertEquals("Olympus E-PL7", cameraDisplay("OLYMPUS IMAGING CORP.", "E-PL7"))
    assertEquals("Google Pixel 7a", cameraDisplay("Google", "Pixel 7a"))
    assertEquals("Canon EOS R6", cameraDisplay("Canon", "Canon EOS R6"))
    assertEquals("NIKON Z 6", cameraDisplay("NIKON CORPORATION", "NIKON Z 6"))
    assertEquals("Sony ILCE-7M4", cameraDisplay("SONY", "ILCE-7M4"))
    assertEquals("E-PL7", cameraDisplay(null, "E-PL7"))
    assertNull(cameraDisplay(null, null))
}

fun testExposureDisplayJoinsWhatIsKnown() {
    assertEquals("17 mm · f/2.8 · 1/250 s · ISO 200", exposureDisplay(17.0, 2.8, 0.004, 200))
    assertEquals("f/2 · 1/60 s", exposureDisplay(null, 2.0, 1.0 / 60, null))
    assertEquals("5.5 mm · f/1.9", exposureDisplay(5.49, 1.9, null, null))
    assertNull(exposureDisplay(null, null, null, null))
}

fun testShutterDisplay() {
    assertEquals("1/8000 s", shutterDisplay(1.0 / 8000))
    assertEquals("1/3 s", shutterDisplay(0.3333))
    assertEquals("2 s", shutterDisplay(2.0))
    assertEquals("2.5 s", shutterDisplay(2.5))
}

fun testOtherDisplays() {
    assertEquals("26 Sep 2026, 16:11", captureDisplay(LocalDateTime.of(2026, 9, 26, 16, 11, 55)))
    assertEquals("1 photo", photoCountDisplay(1))
    assertEquals("212 photos", photoCountDisplay(212))
    assertEquals("7.6 MB", fileSizeDisplay(7_617_261))
    assertEquals("832 KB", fileSizeDisplay(832_400))
    assertEquals("4608 × 3456 · 15.9 MP", dimensionsDisplay(4608, 3456))
}
