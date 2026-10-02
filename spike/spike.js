// proof Phase 1 spike: can mini-gl (as-is, or with a half-float fork) carry Snapseed-style editing
// of a 24 MP photo in the browser? Throwaway code -- see README.md for what each test measures.
import { minigl as minigl8 } from './lib/mini-gl-2823885/minigl.js'
import { minigl as minigl16 } from './lib/mini-gl-2823885-f16/minigl.js'
import * as exif from './jpeg-exif.js'

const VARIANTS = {
  u8: { label: 'mini-gl upstream — SRGB8 intermediates', make: minigl8 },
  f16: { label: 'spike fork — RGBA16F intermediates', make: minigl16 },
}
const query = new URLSearchParams(location.search)
const AUTO = query.has('auto')
const MP = Number(query.get('mp') || 24)
const FRAMES = Number(query.get('frames') || 20)
const PREVIEW_LONG_EDGE = 1600

// ---- edit stacks: one mini-gl pass per Snapseed tool, the way proof's stack would map onto it ----
const IDENTITY = { brightness: 0, contrast: 0, saturation: 0, highlights: 0, shadows: 0, temperature: 0, tint: 0, curve: 0, clarity: 0, vignette: 0 }
const REALISTIC = { brightness: 0.1, contrast: 0.15, saturation: 0.15, highlights: -0.3, shadows: 0.4, temperature: 0.15, tint: 0.05, curve: 0.5, clarity: 0.3, vignette: 0.3 }
const TONAL = { ...REALISTIC, clarity: 0, vignette: 0 } // REALISTIC minus the spatial tools, for the 1-D ramp tests
const HEAVY = { ...IDENTITY, saturation: 0.3, highlights: -0.6, shadows: 0.8, temperature: 0.3, curve: 1 }

const curvePoints = (a) => [[0, 0], [0.25, 0.25 - 0.08 * a], [0.75, 0.75 + 0.08 * a], [1, 1]]

function renderStack(mini, p) {
  mini.loadImage()
  mini.filterAdjustments({ brightness: p.brightness, contrast: p.contrast, saturation: p.saturation }) // Tune Image
  mini.filterHighlightsShadows(p.highlights, p.shadows) //                                              Tune Image (cont.)
  mini.filterAdjustments({ temperature: p.temperature, tint: p.tint }) //                               White Balance
  mini.filterCurves([curvePoints(p.curve), null, null, null]) //                                        Curves
  mini.filterAdjustments({ clarity: p.clarity }) //                                                    Details
  mini.filterAdjustments({ vignette: p.vignette }) //                                                  Vignette
  mini.paintCanvas()
}
const STACK_PASSES = 7 // loadImage + 6 tools (paintCanvas not counted)

// ---- small utilities ----
const $ = (id) => document.getElementById(id)
const results = {
  spike: 'proof Phase 1 — mini-gl @ 28238857',
  ranAt: new Date().toISOString(),
  config: { megapixelsSynthetic: MP, benchmarkFrames: FRAMES, previewLongEdge: PREVIEW_LONG_EDGE },
}
function record(section, data) {
  results[section] = { ...(results[section] || {}), ...data }
  $('results').textContent = JSON.stringify(results, null, 2)
}
function status(msg) { $('status').textContent = msg; console.log('[spike]', msg) }
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
const ms = (t) => Math.round(t * 10) / 10
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] }
const toBlob = (canvas, type, q) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob returned null'))), type, q))
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer())

async function blobToImage(blob) {
  const img = new Image()
  img.src = URL.createObjectURL(blob)
  await img.decode()
  return img
}

// A high-quality downscale to PREVIEW_LONG_EDGE, made once per photo; stands in for the server-side preview.
async function previewImage(img) {
  const s = PREVIEW_LONG_EDGE / Math.max(img.naturalWidth, img.naturalHeight)
  if (s >= 1) return img
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s)
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, c.width, c.height)
  return blobToImage(await toBlob(c, 'image/png'))
}

function newMini(variant, img) {
  const canvas = document.createElement('canvas')
  let lost = false, disposed = false
  canvas.addEventListener('webglcontextlost', () => { if (disposed) return; lost = true; record('errors', { [`contextLost_${variant}_${Date.now()}`]: true }) })
  const mini = VARIANTS[variant].make(canvas, img, 'srgb')
  if (!mini) throw new Error(`${variant}: minigl() failed (see console — WebGL2 or EXT_color_buffer_float missing?)`)
  return {
    mini, canvas, gl: mini.gl,
    get lost() { return lost },
    dispose() { disposed = true; mini.destroy(); mini.gl.getExtension('WEBGL_lose_context')?.loseContext() },
  }
}

// Blocks until the GPU has finished: a 1-pixel readback of the default framebuffer (after paintCanvas).
function sync(gl) { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)) }

function compare(a, aw, b, bw, x0, y0, w, h, bx0 = x0, by0 = y0) {
  let changed = 0, max = 0, sum = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((y0 + y) * aw + x0 + x) * 4, j = ((by0 + y) * bw + bx0 + x) * 4
    let px = 0
    for (let c = 0; c < 3; c++) { const d = Math.abs(a[i + c] - b[j + c]); sum += d; if (d > max) max = d; if (d) px = 1 }
    changed += px
  }
  return { pixelsChanged: changed, pixelsCompared: w * h, maxDiff: max, meanDiff: Math.round((sum / (w * h * 3)) * 1000) / 1000 }
}

function regionPixels(img, x, y, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d', { colorSpace: 'srgb' })
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h).data
}

// ---- test images ----
async function syntheticPhoto(mp) {
  const W = Math.round(Math.sqrt((mp * 1e6) * 1.5)), H = Math.round(W / 1.5)
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')
  const sky = ctx.createLinearGradient(0, 0, W * 0.3, H * 0.5) // smooth sky: the classic banding victim
  sky.addColorStop(0, 'rgb(28,62,128)'); sky.addColorStop(1, 'rgb(186,212,236)')
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H * 0.5)
  const gray = ctx.createLinearGradient(0, 0, W, 0)
  gray.addColorStop(0, '#000'); gray.addColorStop(1, '#fff')
  ctx.fillStyle = gray; ctx.fillRect(0, H * 0.5, W, H * 0.2)
  const shadow = ctx.createLinearGradient(0, 0, W, 0) // deep-shadow ramp, 0..40 — where 8-bit linear LUTs posterize
  shadow.addColorStop(0, 'rgb(0,0,0)'); shadow.addColorStop(1, 'rgb(40,40,40)')
  ctx.fillStyle = shadow; ctx.fillRect(0, H * 0.7, W, H * 0.15)
  const hues = ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad', '#d2a679', '#7f8c8d']
  hues.forEach((h, i) => { ctx.fillStyle = h; ctx.fillRect((W / hues.length) * i, H * 0.85, W / hues.length, H * 0.15) })
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 // fine detail for clarity/sharpening to bite on
  for (let x = 0; x < W * 0.25; x += 6) { ctx.beginPath(); ctx.moveTo(x + 0.5, H * 0.86); ctx.lineTo(x + 0.5, H * 0.99); ctx.stroke() }
  const jpeg = await bytesOf(await toBlob(c, 'image/jpeg', 0.95))
  const withExif = exif.spliceExif(jpeg, exif.buildExif({ make: 'proof-spike', model: 'synthetic', orientation: 1, dateTimeOriginal: '2026:10:02 12:00:00' }))
  return { name: `synthetic-${W}x${H}.jpg`, bytes: withExif }
}

// 256 x 5 lossless ramp: gray, red, green, blue, mixed — one input level per column.
async function rampImage() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 5
  const ctx = c.getContext('2d')
  const d = ctx.createImageData(256, 5)
  const rows = [(i) => [i, i, i], (i) => [i, 0, 0], (i) => [0, i, 0], (i) => [0, 0, i], (i) => [i, 255 - i, 128]]
  rows.forEach((f, y) => { for (let i = 0; i < 256; i++) { const k = (y * 256 + i) * 4; const [r, g, b] = f(i); d.data.set([r, g, b, 255], k) } })
  ctx.putImageData(d, 0, 0)
  return { img: await blobToImage(await toBlob(c, 'image/png')), pixels: d.data }
}

// ---- tests ----
function deviceInfo() {
  const c = document.createElement('canvas')
  const gl = c.getContext('webgl2')
  if (!gl) { record('device', { webgl2: false }); throw new Error('WebGL2 not available') }
  const dbg = gl.getExtension('WEBGL_debug_renderer_info')
  record('device', {
    userAgent: navigator.userAgent,
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxViewportDims: [...gl.getParameter(gl.MAX_VIEWPORT_DIMS)],
    maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    EXT_color_buffer_float: !!gl.getExtension('EXT_color_buffer_float'),
    EXT_color_buffer_half_float: !!gl.getExtension('EXT_color_buffer_half_float'),
    OES_texture_float_linear: !!gl.getExtension('OES_texture_float_linear'),
    devicePixelRatio, screen: [screen.width, screen.height],
    deviceMemoryGB: navigator.deviceMemory ?? null, hardwareConcurrency: navigator.hardwareConcurrency ?? null,
  })
  gl.getExtension('WEBGL_lose_context')?.loseContext()
}

// Does a JPEG with EXIF Orientation=6 arrive in the WebGL texture upright?
async function orientationTest() {
  const c = document.createElement('canvas'); c.width = 400; c.height = 200
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 200, 200)
  ctx.fillStyle = '#00f'; ctx.fillRect(200, 0, 200, 200)
  const jpeg = exif.spliceExif(await bytesOf(await toBlob(c, 'image/jpeg', 0.95)),
    exif.buildExif({ make: 'x', model: 'y', orientation: 6, dateTimeOriginal: '2026:10:02 12:00:00' }))
  const img = await blobToImage(new Blob([jpeg], { type: 'image/jpeg' }))
  const m = newMini('u8', img)
  m.mini.loadImage()
  const px = m.mini.readPixels()
  const w = m.canvas.width, h = m.canvas.height
  const at = (x, y) => { const i = (Math.floor(y) * w + Math.floor(x)) * 4; return px[i] > 128 ? 'red' : px[i + 2] > 128 ? 'blue' : 'other' }
  const sample = { top: at(w / 2, h * 0.1), bottom: at(w / 2, h * 0.9), left: at(w * 0.1, h / 2), right: at(w * 0.9, h / 2) }
  m.dispose()
  // Orientation 6 = rotate 90° CW to display: the stored left (red) half ends up on top.
  const verdict = w === 200 && h === 400 && sample.top === 'red' && sample.bottom === 'blue' ? 'upright (browser applied EXIF orientation on upload)'
    : w === 200 && h === 400 ? 'DISTORTED (naturalWidth/Height rotated, texture not)'
    : 'ignored (texture and dimensions unrotated)'
  record('orientation', { storedSize: '400x200', naturalSize: `${img.naturalWidth}x${img.naturalHeight}`, textureSize: `${w}x${h}`, sample, verdict })
}

// Every tool at its default parameters must be an exact identity (AGENTS.md).
async function identityTest(ramp) {
  const passes = {
    passthrough: (mini) => mini.loadImage(),
    adjustments: (mini) => { mini.loadImage(); mini.filterAdjustments({}) },
    highlightsShadows: (mini) => { mini.loadImage(); mini.filterHighlightsShadows(0, 0) },
    curvesIdentity: (mini) => { mini.loadImage(); mini.filterCurves([[[0, 0], [1, 1]], null, null, null]) },
    highlightsShadowsThenDetails: (mini) => { mini.loadImage(); mini.filterHighlightsShadows(0, 0); mini.filterAdjustments({ clarity: 0 }) },
    fullStackAtDefaults: (mini) => renderStack(mini, IDENTITY),
  }
  const out = {}
  for (const v of Object.keys(VARIANTS)) {
    const m = newMini(v, ramp.img)
    out[v] = {}
    for (const [name, run] of Object.entries(passes)) {
      run(m.mini)
      const px = m.mini.readPixels()
      const grayRow = [...Array(256).keys()].map((i) => px[i * 4])
      out[v][name] = { ...compare(px, 256, ramp.pixels, 256, 0, 0, 256, 5), grayLevelsOut: new Set(grayRow).size, gray0to16: grayRow.slice(0, 17).join(',') }
    }
    m.dispose()
  }
  record('identity', out)
}

// Heavy and realistic stacks over the ramp: how many of the 256 input gray levels survive, and how big
// is the biggest step between neighbouring output levels (a visible band)?
async function bandingTest(ramp) {
  const out = {}, rows = {}
  for (const [stackName, p] of Object.entries({ tonal: TONAL, heavy: HEAVY })) {
    out[stackName] = {}
    for (const v of Object.keys(VARIANTS)) {
      const m = newMini(v, ramp.img)
      renderStack(m.mini, p)
      const px = m.mini.readPixels()
      m.dispose()
      rows[`${stackName}_${v}`] = px
      const gray = [...Array(256).keys()].map((i) => px[i * 4])
      // Only the unclipped part of the output counts: a step there is a visible band in a smooth gradient.
      const open = gray.filter((g) => g > 0 && g < 255)
      const levels = [...new Set(open)].sort((a, b) => a - b)
      let maxGap = 0
      for (let i = 1; i < levels.length; i++) maxGap = Math.max(maxGap, levels[i] - levels[i - 1])
      out[stackName][v] = {
        inputLevelsClippedToBlack: gray.filter((g) => g === 0).length, inputLevelsClippedToWhite: gray.filter((g) => g === 255).length,
        distinctUnclippedLevels: levels.length, maxStepBetweenUnclippedLevels: maxGap,
        distinctShadowLevels_in0to48: new Set(gray.slice(0, 49)).size, grayOut0to24: gray.slice(0, 25).join(','),
      }
    }
    out[stackName].u8_vs_f16 = compare(rows[`${stackName}_u8`], 256, rows[`${stackName}_f16`], 256, 0, 0, 256, 5)
  }
  // Which tool, alone at its REALISTIC value, clips input levels? (u8; tonal tools only)
  const single = {
    brightness: (mini) => mini.filterAdjustments({ brightness: REALISTIC.brightness }),
    contrast: (mini) => mini.filterAdjustments({ contrast: REALISTIC.contrast }),
    saturation: (mini) => mini.filterAdjustments({ saturation: REALISTIC.saturation }),
    highlightsShadows: (mini) => mini.filterHighlightsShadows(REALISTIC.highlights, REALISTIC.shadows),
    whiteBalance: (mini) => mini.filterAdjustments({ temperature: REALISTIC.temperature, tint: REALISTIC.tint }),
    curve: (mini) => mini.filterCurves([curvePoints(REALISTIC.curve), null, null, null]),
  }
  out.perToolAlone_u8 = {}
  const m = newMini('u8', ramp.img)
  for (const [name, run] of Object.entries(single)) {
    m.mini.loadImage(); run(m.mini)
    const px = m.mini.readPixels()
    const gray = [...Array(256).keys()].map((i) => px[i * 4])
    out.perToolAlone_u8[name] = { value: name === 'highlightsShadows' ? [REALISTIC.highlights, REALISTIC.shadows] : name === 'whiteBalance' ? [REALISTIC.temperature, REALISTIC.tint] : REALISTIC[name],
      inputLevelsClippedToBlack: gray.filter((g) => g === 0).length, inputLevelsClippedToWhite: gray.filter((g) => g === 255).length, grayOut0to16: gray.slice(0, 17).join(',') }
  }
  m.dispose()
  record('banding', out)
  drawBandingStrips(rows)
}

function drawBandingStrips(rows) {
  const host = $('banding'); host.innerHTML = ''
  for (const [name, px] of Object.entries(rows)) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 5
    const ctx = c.getContext('2d')
    const d = ctx.createImageData(256, 5); d.data.set(px); ctx.putImageData(d, 0, 0)
    const amp = document.createElement('canvas'); amp.width = 64; amp.height = 1 // gray row, first 64 levels, stretched x4
    const actx = amp.getContext('2d'); const ad = actx.createImageData(64, 1)
    for (let i = 0; i < 64; i++) { const v = Math.min(255, px[i * 4] * 4); ad.data.set([v, v, v, 255], i * 4) }
    actx.putImageData(ad, 0, 0)
    const fig = document.createElement('figure')
    fig.innerHTML = `<figcaption>${name}</figcaption>`
    c.className = amp.className = 'strip'
    fig.append(c, amp)
    host.append(fig)
  }
}

async function benchmark(photo, variant, mode) {
  const t0 = performance.now()
  const m = newMini(variant, mode === 'preview' ? photo.preview : photo.img)
  renderStack(m.mini, REALISTIC); sync(m.gl)
  const firstRender = performance.now() - t0
  renderStack(m.mini, REALISTIC); sync(m.gl) // warm-up
  const times = []
  for (let f = 0; f < FRAMES; f++) {
    const t = performance.now()
    renderStack(m.mini, { ...REALISTIC, brightness: 0.2 * Math.sin(f) })
    sync(m.gl)
    times.push(performance.now() - t)
  }
  const size = `${m.canvas.width}x${m.canvas.height}`
  const lost = m.lost
  m.dispose()
  const med = median(times)
  return { renderSize: size, passes: STACK_PASSES, uploadAndFirstRenderMs: ms(firstRender), frameMsMedian: ms(med), frameMsP95: ms(p95(times)), approxFps: Math.round(1000 / med), contextLost: lost }
}

let lastExport = null
async function exportTest(photo, variant) {
  const m = newMini(variant, photo.img)
  const r = {}
  let t = performance.now()
  renderStack(m.mini, REALISTIC); sync(m.gl)
  r.renderMs = ms(performance.now() - t)
  t = performance.now()
  const px = m.mini.readPixels()
  r.readPixelsMs = ms(performance.now() - t)
  const w = m.canvas.width, h = m.canvas.height
  const lost = m.lost
  m.dispose()
  t = performance.now()
  const c = document.createElement('canvas'); c.width = w; c.height = h
  c.getContext('2d', { colorSpace: 'srgb' }).putImageData(new ImageData(new Uint8ClampedArray(px.buffer), w, h, { colorSpace: 'srgb' }), 0, 0)
  r.putImageDataMs = ms(performance.now() - t)
  t = performance.now()
  const jpeg = await bytesOf(await toBlob(c, 'image/jpeg', 0.92))
  r.toBlobJpegMs = ms(performance.now() - t)
  r.jpegBytes = jpeg.length
  c.width = c.height = 0
  r.toBlobOutputHasExif = !!exif.exifSegment(jpeg)
  const orig = exif.exifSegment(photo.bytes)
  if (orig) {
    t = performance.now()
    const spliced = exif.spliceExif(jpeg, exif.withOrientation(orig, 1))
    r.exifSpliceMs = ms(performance.now() - t)
    const before = exif.readExif(orig), after = exif.readExif(exif.exifSegment(spliced))
    r.exif = {
      original: { make: before.make, model: before.model, orientation: before.orientation, dateTimeOriginal: before.dateTimeOriginal },
      spliced: { make: after.make, model: after.model, orientation: after.orientation, dateTimeOriginal: after.dateTimeOriginal },
    }
    const reopened = await blobToImage(new Blob([spliced], { type: 'image/jpeg' })) // still a decodable JPEG?
    r.splicedDecodes = reopened.naturalWidth === w && reopened.naturalHeight === h
    lastExport = { name: photo.name.replace(/\.\w+$/, '') + `.proof-${variant}.jpg`, bytes: spliced }
  } else {
    r.exif = 'original has no Exif APP1 — splice not tested'
    lastExport = { name: photo.name.replace(/\.\w+$/, '') + `.proof-${variant}.jpg`, bytes: jpeg }
  }
  r.totalMs = ms(r.renderMs + r.readPixelsMs + r.putImageDataMs + r.toBlobJpegMs + (r.exifSpliceMs || 0))
  r.contextLost = lost
  $('download').disabled = false
  return r
}

// Identity render vs the browser's own 2D decode (GPU path exact?), then through toBlob JPEG.
async function colorTest(photo) {
  const W = photo.img.naturalWidth, H = photo.img.naturalHeight
  const S = Math.min(512, W, H), x0 = Math.floor((W - S) / 2), y0 = Math.floor((H - S) / 2)
  const ref = regionPixels(photo.img, x0, y0, S, S)
  const out = {}
  for (const v of Object.keys(VARIANTS)) {
    const m = newMini(v, photo.img)
    m.mini.loadImage()
    const px = m.mini.readPixels()
    m.dispose()
    out[`${v}_gpuIdentity_vs_2dDecode`] = compare(px, W, ref, S, x0, y0, S, S, 0, 0)
    if (v === 'u8') {
      const c = document.createElement('canvas'); c.width = S; c.height = S
      const crop = new Uint8ClampedArray(S * S * 4)
      for (let y = 0; y < S; y++) crop.set(px.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + S) * 4), y * S * 4)
      c.getContext('2d').putImageData(new ImageData(crop, S, S), 0, 0)
      const back = await blobToImage(await toBlob(c, 'image/jpeg', 0.92))
      out.jpeg092RoundTrip_vs_gpu = compare(regionPixels(back, 0, 0, S, S), S, crop, S, 0, 0, S, S)
    }
  }
  out.region = `${S}x${S} centre crop`
  record('color', out)
}

// ---- orchestration ----
let photo = null
async function loadPhoto(name, bytes) {
  disposeInteractive()
  const img = await blobToImage(new Blob([bytes], { type: 'image/jpeg' }))
  const t = performance.now()
  const preview = await previewImage(img)
  photo = { name, bytes, img, preview }
  record('photo', { previewDownscaleMs: ms(performance.now() - t), preview: `${preview.naturalWidth}x${preview.naturalHeight}` })
  const e = exif.exifSegment(bytes)
  record('photo', { name, sizeBytes: bytes.length, natural: `${img.naturalWidth}x${img.naturalHeight}`, megapixels: Math.round((img.naturalWidth * img.naturalHeight) / 1e5) / 10, exif: e ? exif.readExif(e) : null })
  $('run').disabled = false
  startInteractive()
}

async function runAll() {
  if (!photo) return
  $('run').disabled = true
  disposeInteractive()
  try {
    status('device info…'); deviceInfo(); await nextFrame()
    status('orientation…'); await orientationTest(); await nextFrame()
    const ramp = await rampImage()
    status('identity at defaults…'); await identityTest(ramp); await nextFrame()
    status('banding…'); await bandingTest(ramp); await nextFrame()
    for (const v of Object.keys(VARIANTS)) for (const mode of ['preview', 'full']) {
      status(`benchmark ${v} ${mode}…`); await nextFrame()
      record('benchmark', { [`${v}_${mode}`]: await benchmark(photo, v, mode) })
    }
    for (const v of Object.keys(VARIANTS)) {
      status(`full-res export ${v}…`); await nextFrame()
      record('export', { [v]: await exportTest(photo, v) })
    }
    status('colour round-trip…'); await nextFrame(); await colorTest(photo)
    status('done — copy the results JSON below and paste it back')
  } catch (e) {
    record('errors', { fatal: String(e?.stack || e) })
    status(`failed: ${e}`)
  } finally {
    $('run').disabled = false
    window.__spikeDone = true
    startInteractive()
  }
}

// ---- interactive slider panel: does dragging *feel* right? ----
let live = null, pending = false
const SLIDERS = Object.keys(IDENTITY)
function disposeInteractive() { if (live) { live.dispose(); live = null; $('stage').innerHTML = '' } }
function startInteractive() {
  if (!photo || AUTO) return
  disposeInteractive()
  live = newMini($('variant').value, $('res').value === 'preview' ? photo.preview : photo.img)
  $('stage').append(live.canvas)
  renderLive()
}
function renderLive() {
  if (!live || pending) return
  pending = true
  requestAnimationFrame(() => {
    pending = false
    const p = Object.fromEntries(SLIDERS.map((k) => [k, Number($(`s_${k}`).value)]))
    const t = performance.now()
    renderStack(live.mini, p); sync(live.gl)
    $('frame').textContent = `${ms(performance.now() - t)} ms / frame at ${live.canvas.width}x${live.canvas.height}`
  })
}

function buildControls() {
  $('sliders').innerHTML = SLIDERS.map((k) => `<label>${k}<input id="s_${k}" type="range" min="-1" max="1" step="0.01" value="0"></label>`).join('')
  SLIDERS.forEach((k) => $(`s_${k}`).addEventListener('input', renderLive))
  $('variant').addEventListener('change', startInteractive)
  $('res').addEventListener('change', startInteractive)
  $('file').addEventListener('change', async (e) => {
    const f = e.target.files[0]
    if (f) { status(`loading ${f.name}…`); await loadPhoto(f.name, new Uint8Array(await f.arrayBuffer())); status('loaded — drag sliders, or Run all tests') }
  })
  $('synthetic').addEventListener('click', async () => { status('generating synthetic photo…'); await nextFrame(); const s = await syntheticPhoto(MP); await loadPhoto(s.name, s.bytes); status('loaded — drag sliders, or Run all tests') })
  $('run').addEventListener('click', runAll)
  $('copy').addEventListener('click', () => {
    const text = JSON.stringify(results, null, 2)
    if (navigator.clipboard) return navigator.clipboard.writeText(text).then(() => status('results copied'))
    // plain-http LAN origins (e.g. an iPad hitting http://<lan-ip>:8000) have no clipboard API
    getSelection().selectAllChildren($('results')); status('clipboard unavailable here — results text selected, copy it manually')
  })
  $('saveResults').addEventListener('click', () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' }))
    a.download = `proof-spike-results-${Date.now()}.json`; a.click()
  })
  $('download').addEventListener('click', () => {
    if (!lastExport) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([lastExport.bytes], { type: 'image/jpeg' })); a.download = lastExport.name; a.click()
  })
}

buildControls()
window.__spikeResults = results
if (AUTO) {
  (async () => { status('auto: generating synthetic photo…'); const s = await syntheticPhoto(MP); await loadPhoto(s.name, s.bytes); await runAll() })()
    .catch((e) => { record('errors', { fatal: String(e?.stack || e) }); window.__spikeDone = true })
}
