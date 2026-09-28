/**
 * storage-read.js — read a Directus-managed file's bytes through the storage abstraction.
 *
 * WHY
 * ---
 * Two endpoints used to do this:
 *
 *     const filePath = path.resolve(UPLOAD_DIR, row.filename_disk)
 *     const bytes = await readFile(filePath)
 *
 * which hard-assumes the `local` storage driver and a bind-mounted uploads dir. That
 * breaks the moment files move to S3/R2 — and it breaks silently for exactly the files
 * we least want to be careless with (registration ID scans, expense receipts).
 *
 * AssetsService.getAsset() resolves the driver from `directus_files.storage` per row, so
 * it works on `local`, on R2, and during a mixed-state migration where some rows say
 * 'local' and some say 'r2'.
 *
 * ACCESS CONTROL
 * --------------
 * We pass `accountability: null` (sudo). That is deliberate and safe ONLY because every
 * caller authorizes first and passes a file id it derived from the caller's own row:
 *   - registration.js  → id comes from the caller's own registrations row, and the query
 *                        additionally pins folder = REGISTRATION_FILES_FOLDER
 *   - expense-upload.js → id comes from the caller's own expense row
 * Do not call this with a file id taken straight from user input.
 */

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

/**
 * @param {string} fileId              directus_files.id (uuid)
 * @param {object} deps                { services, getSchema, database }
 * @param {object} [opts]
 * @param {number} [opts.maxBytes]     abort past this many bytes (default 10 MB)
 * @returns {Promise<{ file: object, bytes: Buffer }>}
 */
export async function readManagedFile(fileId, { services, getSchema, database }, opts = {}) {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const { AssetsService } = services

  const assets = new AssetsService({
    schema: await getSchema(),
    accountability: null,
    knex: database,
  })

  // transformation = null → no image preset, plain byte-for-byte read.
  const { stream, file } = await assets.getAsset(fileId, null)

  const chunks = []
  let total = 0
  for await (const chunk of stream) {
    total += chunk.length
    if (total > maxBytes) {
      stream.destroy()
      const err = new Error(`File too large (max ${Math.floor(maxBytes / 1024 / 1024)} MB)`)
      err.status = 413
      throw err
    }
    chunks.push(chunk)
  }

  return { file, bytes: Buffer.concat(chunks) }
}

/**
 * Stream a managed file straight to an Express response. Preferred over readManagedFile()
 * when the bytes are only being forwarded to the client (no OCR, no attachment) — it keeps
 * large PDFs off the heap.
 */
export async function streamManagedFile(fileId, { services, getSchema, database }, res, { filename, type } = {}) {
  const { AssetsService } = services

  const assets = new AssetsService({
    schema: await getSchema(),
    accountability: null,
    knex: database,
  })

  const { stream, file } = await assets.getAsset(fileId, null)

  const contentType = type || file.type || 'application/octet-stream'
  res.setHeader('Content-Type', contentType)
  // These are USER-uploaded files served inline on the API origin. nosniff stops a
  // browser from upgrading a mislabelled upload to HTML/script; anything that is
  // not a PDF or a raster image is additionally sandboxed (opaque origin, no
  // script), so an uploaded SVG/HTML cannot run as directus.kscw.ch. PDFs and
  // raster images are exempt: Chrome's PDF viewer refuses to render inside a
  // CSP sandbox, and a raster image cannot execute anything.
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (!/^(application\/pdf|image\/(png|jpe?g|gif|webp|heic|heif|avif))\b/i.test(contentType)) {
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'")
  }
  const safeName = String(filename || file.filename_download || 'file').replace(/[^\w.\- ]/g, '_')
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`)

  return new Promise((resolve, reject) => {
    stream.on('error', reject)
    res.on('finish', resolve)
    stream.pipe(res)
  })
}
