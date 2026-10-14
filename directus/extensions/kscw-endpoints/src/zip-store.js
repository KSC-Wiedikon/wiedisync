/**
 * Minimal ZIP writer — STORE method only (no compression), pure, no dependency.
 *
 * Used for the yearly finance archive (finance-books.js): CSVs, a PDF and the
 * receipts, which are PDFs/JPEGs and already compressed. Uncompressed ZIP is part
 * of the base format every unzip tool reads, and a 10-year archive is better off
 * without a codec dependency. Names are stored as UTF-8 (general-purpose flag bit
 * 11). Limits: < 65'535 entries, every file and the whole archive < 4 GiB (no
 * ZIP64) — far above one club year.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** MS-DOS date/time of a Date (local wall clock, 2-second resolution). */
function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

/**
 * @param {Array<{ name: string, data: Buffer|Uint8Array|string }>} files
 * @param {Date} [when] timestamp written on every entry
 * @returns {Buffer}
 */
export function buildZip(files, when = new Date()) {
  if (files.length >= 0xffff) throw new Error('Too many files for a non-ZIP64 archive')
  const { time, date } = dosDateTime(when)
  const locals = []
  const centrals = []
  let offset = 0
  const seen = new Set()
  for (const f of files) {
    const name = String(f.name).replace(/^\/+/, '')
    if (!name || seen.has(name)) throw new Error(`Duplicate or empty file name in archive: "${name}"`)
    seen.add(name)
    const nameBuf = Buffer.from(name, 'utf8')
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data)
    if (data.length >= 0xffffffff) throw new Error(`${name} is too large for a non-ZIP64 archive`)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)          // version needed
    local.writeUInt16LE(0x0800, 6)      // UTF-8 names
    local.writeUInt16LE(0, 8)           // STORE
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBuf, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)        // version made by
    central.writeUInt16LE(20, 6)        // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)        // extra
    central.writeUInt16LE(0, 32)        // comment
    central.writeUInt16LE(0, 34)        // disk
    central.writeUInt16LE(0, 36)        // internal attrs
    central.writeUInt32LE(0, 38)        // external attrs
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const cd = Buffer.concat(centrals)
  if (offset + cd.length >= 0xffffffff) throw new Error('Archive too large for a non-ZIP64 archive')
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, cd, end])
}
