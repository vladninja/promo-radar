/**
 * Builds tests/fixtures/leaflet-2pages.pdf from a full leaflet PDF.
 *
 * Slicing with pdfseparate/pdfunite carries the whole shared resource set
 * (91 MB for two pages), and qpdf/ghostscript are not available here. So we
 * rasterize the two pages and wrap the JPEGs in a minimal PDF. The result is
 * image-only at the original page size — the same character as the real
 * leaflets, which carry no text layer either.
 *
 * Usage: node tests/fixtures/build-fixture.mjs <source.pdf> <out.pdf>
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [src, out] = process.argv.slice(2)
if (!src || !out) {
  console.error('usage: node build-fixture.mjs <source.pdf> <out.pdf>')
  process.exit(1)
}

const DPI = 110
const info = execFileSync('pdfinfo', [src]).toString()
const size = info.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts/m)
if (!size) throw new Error('could not read page size')
const ptW = Number(size[1])
const ptH = Number(size[2])
const pxW = Math.round((ptW / 72) * DPI)
const pxH = Math.round((ptH / 72) * DPI)

const dir = mkdtempSync(join(tmpdir(), 'fixture-'))
const jpegs = []
for (const pageNo of [1, 2]) {
  const prefix = join(dir, `p${pageNo}`)
  execFileSync('pdftoppm', [
    '-f', String(pageNo), '-l', String(pageNo), '-r', String(DPI),
    '-jpeg', '-jpegopt', 'quality=75', '-singlefile', src, prefix,
  ])
  jpegs.push(readFileSync(`${prefix}.jpg`))
}

// Minimal PDF: catalog, pages, two page objects, two content streams,
// two DCTDecode image XObjects.
const chunks = []
const offsets = []
let length = 0
const push = (buf) => {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'latin1')
  chunks.push(b)
  length += b.length
}
const obj = (n, body) => {
  offsets[n] = length
  push(`${n} 0 obj\n`)
  push(body)
  push('\nendobj\n')
}

push('%PDF-1.4\n')
obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
obj(2, '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>')

for (const [i] of jpegs.entries()) {
  obj(3 + i,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] ` +
    `/Resources << /XObject << /Im0 ${7 + i} 0 R >> >> /Contents ${5 + i} 0 R >>`)
}

for (const [i] of jpegs.entries()) {
  const content = `q ${ptW} 0 0 ${ptH} 0 0 cm /Im0 Do Q`
  obj(5 + i, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
}

for (const [i, jpeg] of jpegs.entries()) {
  offsets[7 + i] = length
  push(`${7 + i} 0 obj\n`)
  push(
    `<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
    `/Length ${jpeg.length} >>\nstream\n`)
  push(jpeg)
  push('\nendstream\nendobj\n')
}

const xrefStart = length
const count = 9
let xref = `xref\n0 ${count}\n0000000000 65535 f \n`
for (let n = 1; n < count; n++) {
  xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
}
xref += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
push(xref)

writeFileSync(out, Buffer.concat(chunks))
console.log(`wrote ${out}: 2 pages, ${ptW} x ${ptH} pts, ${pxW}x${pxH} px images`)
