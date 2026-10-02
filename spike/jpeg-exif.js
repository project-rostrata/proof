// Minimal JPEG/EXIF helpers for the spike. Mirrors what the Kotlin backend will do on save
// (PROJECT_BRIEF.md §4): copy the original's Exif APP1 segment into the browser's render and
// reset Orientation to 1. Throwaway code -- the real implementation is server-side Kotlin.

const SOI = 0xffd8, APP1 = 0xffe1, SOS = 0xffda

// Marker segments between SOI and SOS: [{marker, start, end}] where [start, end) covers the
// whole segment including its 0xFFxx marker and 2-byte length.
export function segments(bytes) {
  if (((bytes[0] << 8) | bytes[1]) !== SOI) throw new Error('not a JPEG')
  const out = []
  let i = 2
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) throw new Error(`bad marker at ${i}`)
    const marker = (bytes[i] << 8) | bytes[i + 1]
    if (marker === SOS) break
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    out.push({ marker, start: i, end: i + 2 + len })
    i += 2 + len
  }
  return out
}

const isExif = (bytes, seg) =>
  seg.marker === APP1 && String.fromCharCode(...bytes.subarray(seg.start + 4, seg.start + 10)) === 'Exif\0\0'

export function exifSegment(bytes) {
  const seg = segments(bytes).find((s) => isExif(bytes, s))
  return seg ? bytes.slice(seg.start, seg.end) : null
}

// Parses the few tags the spike checks. `app1` is a whole APP1 segment (marker included).
export function readExif(app1) {
  const tiff = 10 // FFE1 + len(2) + "Exif\0\0"(6)
  const dv = new DataView(app1.buffer, app1.byteOffset, app1.byteLength)
  const le = dv.getUint16(tiff) === 0x4949
  const u16 = (o) => dv.getUint16(tiff + o, le)
  const u32 = (o) => dv.getUint32(tiff + o, le)
  const ascii = (o, n) => {
    let s = ''
    for (let k = 0; k < n; k++) {
      const c = app1[tiff + o + k]
      if (c === 0) break
      s += String.fromCharCode(c)
    }
    return s
  }
  const result = {}
  const readIfd = (off) => {
    const n = u16(off)
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12
      const tag = u16(e), count = u32(e + 4)
      const valOff = count > 4 ? u32(e + 8) : e + 8
      if (tag === 0x010f) result.make = ascii(valOff, count)
      if (tag === 0x0110) result.model = ascii(valOff, count)
      if (tag === 0x0112) { result.orientation = u16(e + 8); result.orientationAt = tiff + e + 8; result.le = le }
      if (tag === 0x9003) result.dateTimeOriginal = ascii(valOff, count)
      if (tag === 0x8769) readIfd(u32(e + 8))
    }
  }
  readIfd(u32(4))
  return result
}

// Returns a copy of `app1` with Orientation set to `value` (no-op if the tag is absent).
export function withOrientation(app1, value) {
  const copy = app1.slice()
  const { orientationAt, le } = readExif(copy)
  if (orientationAt !== undefined) new DataView(copy.buffer).setUint16(orientationAt, value, le)
  return copy
}

// SOI + app1 + everything after SOI in `jpeg`, minus any Exif APP1 it already had. Only the Exif
// segment is carried over -- never the original's ICC profile (APP2), because the render is sRGB.
export function spliceExif(jpeg, app1) {
  const drop = segments(jpeg).filter((s) => isExif(jpeg, s))
  const parts = [jpeg.subarray(0, 2), app1]
  let i = 2
  for (const s of drop) { parts.push(jpeg.subarray(i, s.start)); i = s.end }
  parts.push(jpeg.subarray(i))
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

// Builds a small little-endian Exif APP1 (Make, Model, Orientation, DateTimeOriginal) so the
// synthetic test images exercise the same paths a real camera JPEG would.
export function buildExif({ make, model, orientation, dateTimeOriginal }) {
  const str = (s) => [...s].map((c) => c.charCodeAt(0)).concat(0)
  const makeB = str(make), modelB = str(model), dateB = str(dateTimeOriginal)
  const ifd0 = 8, ifd0Len = 2 + 4 * 12 + 4
  const exifIfd = ifd0 + ifd0Len, exifIfdLen = 2 + 12 + 4
  let data = exifIfd + exifIfdLen
  const tiff = new Uint8Array(data + makeB.length + modelB.length + dateB.length)
  const dv = new DataView(tiff.buffer)
  tiff.set([0x49, 0x49, 0x2a, 0x00]); dv.setUint32(4, ifd0, true)
  const entry = (at, tag, type, count, value) => {
    dv.setUint16(at, tag, true); dv.setUint16(at + 2, type, true); dv.setUint32(at + 4, count, true)
    if (type === 3) dv.setUint16(at + 8, value, true); else dv.setUint32(at + 8, value, true)
  }
  const putStr = (bytes) => { const at = data; tiff.set(bytes, at); data += bytes.length; return at }
  dv.setUint16(ifd0, 4, true)
  entry(ifd0 + 2, 0x010f, 2, makeB.length, putStr(makeB))
  entry(ifd0 + 14, 0x0110, 2, modelB.length, putStr(modelB))
  entry(ifd0 + 26, 0x0112, 3, 1, orientation)
  entry(ifd0 + 38, 0x8769, 4, 1, exifIfd)
  dv.setUint32(ifd0 + 50, 0, true)
  dv.setUint16(exifIfd, 1, true)
  entry(exifIfd + 2, 0x9003, 2, dateB.length, putStr(dateB))
  dv.setUint32(exifIfd + 14, 0, true)
  const seg = new Uint8Array(10 + tiff.length)
  seg.set([0xff, 0xe1, ((8 + tiff.length) >> 8) & 0xff, (8 + tiff.length) & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0])
  seg.set(tiff, 10)
  return seg
}
