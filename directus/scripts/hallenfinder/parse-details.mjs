/**
 * parse-details.mjs — pure parser for a Stadt-Zürich hall DETAIL page
 * (`details.php?einrichtung=<id>`), the companion to parse-result.mjs.
 *
 * Zero dependencies (no DOM lib) so it runs in the scrape container and under
 * `node --test`.
 *
 * The page's Details section is a single <p> of `<strong>Label</strong><br/>value`
 * pairs:
 *
 *   <strong>Hallentyp</strong><br/>Doppelhalle<br/><br/>
 *   <strong>Doppelhalle</strong><br/>44,00 x 22,00 x 9,00 m (L x B x H)<a href="kalender.php?einrichtung=165…">
 *   <strong>Halle 1 (1/2)</strong><br/>14,00 x 22,00 x 9,00 m (L x B x H)<a href="…&segment=36">
 *
 * A single-court hall labels its one dimension row "Gesamtfläche"; a multi-court
 * facility labels the whole-hall row with the type name and then lists each
 * partition, every one carrying its own Belegungsplan `segment` id. Either way
 * the FIRST dimension row is the whole hall and the rest are partitions.
 *
 * Result shape:
 *   {
 *     hallTypeLabel: 'Doppelhalle' | null,      // German label, as printed
 *     sizeLabel: '44,00 x 22,00 x 9,00 m' | null,
 *     length: 44, width: 22, height: 9,         // metres, null when unknown
 *     partitions: [{ label, length, width, height, segment }],
 *     photoUrl: absolute URL | null,            // full-size, null when placeholder
 *     photoThumbUrl: absolute URL | null,
 *     contactEmail: 'x@zuerich.ch' | null,
 *   }
 */

export const CITY_BASE = 'https://www.ssd-sporthallen.stadt-zuerich.ch'

/** Decode the entities the site emits, strip tags, collapse whitespace. */
function stripTags(s) {
  return String(s ?? '')
    .replace(/<wbr\s*\/?>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&auml;/gi, 'ä').replace(/&ouml;/gi, 'ö').replace(/&uuml;/gi, 'ü')
    .replace(/&Auml;/gi, 'Ä').replace(/&Ouml;/gi, 'Ö').replace(/&Uuml;/gi, 'Ü')
    .replace(/&szlig;/gi, 'ß')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * "23,00" → 23. Swiss decimal comma. Returns null for a missing value AND for
 * the literal 0,00 the site prints when a measurement is unknown — several
 * Gymnastikräume report height 0,00, and storing that as a real zero would make
 * every ceiling-height filter silently exclude them for the wrong reason.
 */
function toMetres(raw) {
  if (raw == null) return null
  const n = Number(String(raw).replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100) / 100
}

/** Resolve the page's `../assets/...` hrefs against the site root. */
function absolutise(href) {
  if (!href) return null
  const clean = String(href).replace(/^(\.\.\/)+/, '').replace(/^\/+/, '')
  return `${CITY_BASE}/${clean}`
}

/** The site serves `empty.jpg` / `empty.png` as the "no photo on file" placeholder. */
function isPlaceholder(href) {
  return /(^|\/)empty\.(jpe?g|png)$/i.test(String(href ?? ''))
}

const DIM_RE = /^(\d+(?:,\d+)?)\s*x\s*(\d+(?:,\d+)?)\s*x\s*(\d+(?:,\d+)?)\s*m/i

/**
 * Slice out one `<h2 …>Heading</h2>` section, up to the next scroll-up anchor
 * (which the site emits between every section) or the end of the document.
 */
function section(html, heading) {
  const start = html.search(new RegExp(`<h2[^>]*>\\s*${heading}\\s*</h2>`, 'i'))
  if (start < 0) return ''
  const rest = html.slice(start)
  const end = rest.search(/mod_scrollup/i)
  return end < 0 ? rest : rest.slice(0, end)
}

/** Parse one detail page. `html` is the raw response body. */
export function parseHallDetails(html) {
  const details = section(html, 'Details')

  let hallTypeLabel = null
  const dims = []

  // Each `<strong>` starts a label/value pair; the value is the text run
  // between the following <br/> and the next tag (a nested <a> Belegungsplan
  // link, or the <br/><br/> before the next pair).
  for (const chunk of details.split(/<strong[^>]*>/i).slice(1)) {
    const labelEnd = chunk.search(/<\/strong>/i)
    if (labelEnd < 0) continue
    const label = stripTags(chunk.slice(0, labelEnd))
    const rest = chunk.slice(labelEnd)
    const valueM = rest.match(/<br\s*\/?>\s*([^<]+)/i)
    const value = valueM ? stripTags(valueM[1]) : ''

    if (/^Hallentyp$/i.test(label)) {
      hallTypeLabel = value || null
      continue
    }
    const dm = DIM_RE.exec(value)
    if (!dm) continue
    // The partition's own Belegungsplan link carries its segment id; the
    // whole-hall row's link has none.
    const segM = rest.slice(0, rest.search(/<strong/i) < 0 ? rest.length : rest.search(/<strong/i))
      .match(/segment=(\d+)/i)
    dims.push({
      label: label || null,
      sizeLabel: value.replace(/\s*\(L x B x H\)\s*$/i, '').trim(),
      length: toMetres(dm[1]),
      width: toMetres(dm[2]),
      height: toMetres(dm[3]),
      segment: segM ? segM[1] : null,
    })
  }

  const whole = dims[0] ?? null
  const partitions = dims.slice(1)

  // Photo: the gallery <a class="image"> holds the full-size file, the <img>
  // inside it the resized one. Both are the placeholder on halls without a photo.
  const fullM = details.match(/class="image"\s+href="([^"]+)"/i)
  const thumbM = details.match(/<img[^>]*data-src="([^"]+)"/i)
  const fullHref = fullM ? fullM[1] : null
  const thumbHref = thumbM ? thumbM[1] : null

  // Contact: prefer the "ausserschulische Betriebszeiten" address — that is the
  // rental contact, the other one is the school's own operations.
  const contactBlock = section(html, 'Kontakt')
  const ausser = contactBlock.split(/ausserschulische/i)[1] ?? contactBlock
  const mailM = ausser.match(/mailto:([^"?]+)/i)

  return {
    hallTypeLabel,
    sizeLabel: whole?.sizeLabel ?? null,
    length: whole?.length ?? null,
    width: whole?.width ?? null,
    height: whole?.height ?? null,
    partitions,
    photoUrl: fullHref && !isPlaceholder(fullHref) ? absolutise(fullHref) : null,
    photoThumbUrl: thumbHref && !isPlaceholder(thumbHref) ? absolutise(thumbHref) : null,
    contactEmail: mailM ? mailM[1].trim() : null,
  }
}
