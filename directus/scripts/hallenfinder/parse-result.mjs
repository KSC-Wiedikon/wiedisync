/**
 * parse-result.mjs — pure parser for a Stadt-Zürich "freie Termine" result page.
 *
 * Zero dependencies (no DOM lib) so it runs anywhere: the scrape script, the
 * Directus endpoint, and `node --test`. Parses the HTML of
 *   https://www.ssd-sporthallen.stadt-zuerich.ch/freieTermine.php?...
 * (both the single-date `terminart=einmalig` and recurring `terminart=periodisch`
 * result pages share the same teaser markup).
 *
 * Result shape:
 *   { count, halls: [{ einrichtungId, name, window, stadtkreis, stadtquartier, schulkreis, address }] }
 *
 * `count` is the site's own "N Treffer" (a checksum against halls.length).
 * `window` is the "verfügbar" time text shown (e.g. "18:00-22:00"), or '' if absent.
 */

/** Decode the handful of HTML entities the site emits, then strip tags. */
function stripTags(s) {
  return s
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

/** "Stadtkreis 11, Stadtquartier Seebach, Schulkreis Glattal" → parts. */
function parseLocation(text) {
  const t = stripTags(text)
  const kreis = t.match(/Stadtkreis\s+([0-9]+)/i)
  const quartier = t.match(/Stadtquartier\s+([^,]+?)(?:,|$)/i)
  const schulkreis = t.match(/Schulkreis\s+([^,]+?)(?:,|$)/i)
  return {
    stadtkreis: kreis ? kreis[1].trim() : null,
    stadtquartier: quartier ? quartier[1].trim() : null,
    schulkreis: schulkreis ? schulkreis[1].trim() : null,
  }
}

/**
 * Extract the result count. Returns 0 for the "keine Treffer" empty page,
 * the number for "N Treffer", or null if neither marker is present (which the
 * caller treats as unexpected HTML — e.g. an error/validation page).
 */
export function parseResultCount(html) {
  if (/ergab keine Treffer|keine Treffer/i.test(html)) return 0
  const m = html.match(/id="search_result_summary_message"[^>]*>\s*([0-9]+)\s*Treffer/i)
    || html.match(/([0-9]+)\s*Treffer/i)
  return m ? Number(m[1]) : null
}

/**
 * Parse a full result page into { count, halls }.
 * Each hall lives in a `teaser_container` div; we slice the page on that class
 * and pull the fields out of each slice with tolerant regexes.
 */
export function parseSearchResult(html) {
  const count = parseResultCount(html)
  const halls = []

  // Split into per-hall chunks. The first chunk (before the first teaser) is header noise.
  const chunks = html.split(/class="teaser_container"/i).slice(1)
  for (const chunk of chunks) {
    // einrichtung id — appears in the onclick details.php link and the anchors.
    const idM = chunk.match(/einrichtung=(\d+)/)
    if (!idM) continue
    const einrichtungId = idM[1]

    const nameM = chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)
    const name = nameM ? stripTags(nameM[1]) : null
    if (!name) continue

    // Availability window: the coloured <strong> after the "verfügbar" hint.
    const winM = chunk.match(/<strong[^>]*>\s*([0-9]{1,2}:[0-9]{2}\s*-\s*[0-9]{1,2}:[0-9]{2}(?:\s*\/\s*[0-9]{1,2}:[0-9]{2}\s*-\s*[0-9]{1,2}:[0-9]{2})*)\s*<\/strong>/i)
    const window = winM ? winM[1].replace(/\s+/g, '') : ''

    const locM = chunk.match(/class="mod_eventinfo__location-name"[^>]*>([\s\S]*?)<\/span>/i)
    const loc = locM ? parseLocation(locM[1]) : { stadtkreis: null, stadtquartier: null, schulkreis: null }

    const addrM = chunk.match(/class="mod_eventinfo__location-address"[^>]*>([\s\S]*?)<\/span>/i)
    const address = addrM ? stripTags(addrM[1]) : null

    halls.push({ einrichtungId, name, window, ...loc, address })
  }

  return { count, halls }
}
