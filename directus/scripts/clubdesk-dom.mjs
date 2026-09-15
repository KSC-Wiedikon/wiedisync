/**
 * clubdesk-dom.mjs — page-side helpers for the ClubDesk scrapers.
 *
 * Each export is a SELF-CONTAINED function that Playwright serialises and runs
 * inside the page (`page.evaluate(fn, arg)`), so it may reference nothing
 * outside its own body — no imports, no closures. Kept out of the scraper so
 * the rule can be exercised against a real DOM in __tests__/ (the scrapers
 * themselves log in to ClubDesk and cannot be imported without doing so).
 */

/**
 * Where to click for the element whose OWN text (its direct text nodes, not
 * its descendants') equals `exact`, as viewport coordinates — or null.
 *
 * Only candidates that would actually RECEIVE the click count: the candidate
 * must be inside the viewport, and the topmost element at its centre
 * (`document.elementFromPoint`) must be the candidate itself or something
 * inside it. Until 15.09.2026 every element with a non-zero rect qualified,
 * including cells of the import wizard's mapping grid that sit BEHIND the
 * confirmation modal or are scrolled out of its viewport: a create row whose
 * first member is a Gast ("Ja" in the Gast column) put a "Ja" cell lower on
 * screen than the dialog's Ja button, the click landed on the modal glass, the
 * wizard stayed open, and the run still reported `committed:true`. The
 * register never gained the contacts. Same trap for "Nein" and "OK".
 *
 * Among the survivors the lowest on screen wins by default — dialog buttons
 * sit at the bottom of their dialog, and a result dialog stacks on top of the
 * wizard rather than above it.
 */
export function pickExact({ exact, lowest = true }) {
  const vw = window.innerWidth, vh = window.innerHeight
  const c = [...document.querySelectorAll('*')].filter((e) => {
    let t = ''; for (const n of e.childNodes) if (n.nodeType === 3) t += n.textContent
    return t.trim() === exact
  }).map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.height > 0)
    // On screen — a clipped grid row keeps its rect but cannot be clicked.
    .filter(({ r }) => r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh)
    // Hit-test: whatever is painted on top at the centre must belong to the
    // candidate, or the click goes to a glass pane / another dialog instead.
    .filter(({ e, r }) => {
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return !!hit && e.contains(hit)
    })
    .map(({ r }) => r)
  if (!c.length) return null
  const r = (lowest ? c.sort((a, b) => b.top - a.top) : c.sort((a, b) => a.top - b.top))[0]
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
}
