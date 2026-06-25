/**
 * camt.053/.054 import + reconciliation (L2 + L3). ClubDesk stays source of truth;
 * this is the bank-truth cross-check + native-invoice auto-confirm.
 *
 * POST /kscw/finance/camt-import  (Vorstand)  body: { xml }
 *   → parse credits → for each:
 *       • native match (SCOR reference → native invoice, verified) → record payment
 *         + auto-confirm pending/open → paid (confirmed_via='camt');
 *       • else fuzzy ClubDesk guess (amount + payer-name) → FLAG only, never applied;
 *       • else unmatched.
 *   Deduped by the bank entry id (camt_reference) → re-importing a file is a no-op.
 *
 * Validated against the ISO-20022 shape; re-verify against a real UBS export before prod.
 */
import { parseCamt, invoiceIdFromScor, invoiceNumbersFromMessage } from './camt.js'
import { writeUserLog } from './activity-log.js'
import { recomputeInvoice } from './finance-recompute.js'

export function registerFinanceCamt(router, { database, logger }) {
  const log = logger.child({ extension: 'kscw-endpoints', module: 'finance-camt' })

  const todayISO = () => new Date().toISOString().slice(0, 10)
  const norm = (s) => (s == null ? null : String(s).replace(/\s+/g, '').toUpperCase() || null)
  const slim = (c) => ({ amount: c.amount, debtor: c.debtor, reference: c.reference, date: c.valueDate })
  const tokens = (s) => (s || '').toLowerCase().replace(/[^a-zäöüéè ]/g, ' ').split(/\s+/).filter((t) => t.length >= 3)
  const overlap = (a, b) => a.filter((t) => b.includes(t)).length

  async function vorstand(req) {
    if (req.accountability?.admin) return { ok: true, name: null, email: null }
    const userId = req.accountability?.user
    if (!userId) return { ok: false }
    const m = await database('members').where('user', userId).first('first_name', 'last_name', 'email', 'role')
    if (!m) return { ok: false }
    const roles = Array.isArray(m.role) ? m.role : (m.role ? (() => { try { return JSON.parse(m.role) } catch { return [] } })() : [])
    return {
      ok: ['vorstand', 'admin', 'superuser', 'finance'].some((r) => roles.includes(r)),
      name: [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || null,
      email: m.email || null,
    }
  }

  const payRow = (c, importId, extra) => ({
    payment_date: /^\d{4}-\d{2}-\d{2}$/.test(c.valueDate || '') ? c.valueDate : null,
    amount: c.amount, currency: c.currency || null, method: 'camt',
    camt_reference: c.uid || null, reference: c.reference || null, unstructured: c.unstructured || null,
    debtor_name: c.debtor || null, source: 'native', import_batch: importId, ...extra,
  })

  /** Best-effort ClubDesk candidate for a credit: amount-match + payer-name overlap. Flag only. */
  async function fuzzyClubdesk(c) {
    const rows = await database('finance_invoices').where('source', 'clubdesk')
      .andWhere((qb) => qb.where('amount', c.amount).orWhere('open_amount', c.amount))
      .whereNotIn('status', ['Storniert', 'Abgeschrieben'])
      .orderByRaw('CASE WHEN open_amount > 0 THEN 0 ELSE 1 END')
      .limit(30).select('id', 'number', 'recipient_name', 'amount', 'open_amount', 'status')
    if (!rows.length) return null
    if (!c.debtor) return rows.length === 1 ? rows[0] : null
    const dtok = tokens(c.debtor)
    let best = null, score = 0
    for (const r of rows) { const s = overlap(dtok, tokens(r.recipient_name)); if (s > score) { score = s; best = r } }
    return score >= 1 ? best : (rows.length === 1 ? rows[0] : null)
  }

  router.post('/finance/camt-import', async (req, res) => {
    try {
      const actor = await vorstand(req)
      if (!actor.ok) return res.status(403).json({ error: 'Forbidden' })
      const xml = req.body?.xml
      if (typeof xml !== 'string' || xml.length < 20) return res.status(400).json({ error: 'xml body required' })
      if (xml.length > 8_000_000) return res.status(413).json({ error: 'camt file too large (max ~8 MB)' })

      let parsed
      try { parsed = parseCamt(xml) } catch (e) { return res.status(422).json({ error: `Could not parse camt: ${e.message}` }) }

      const [imp] = await database('finance_imports').insert({
        import_type: 'payments', filename: `camt.${parsed.type}`,
        imported_by_name: actor.name, imported_by_email: actor.email, row_count: parsed.credits.length,
      }).returning('id')
      const importId = imp.id ?? imp

      const summary = { type: parsed.type, credits: parsed.credits.length, auto_confirmed: 0, clubdesk_guesses: 0, unmatched: 0, duplicates: 0, skipped: 0 }
      const details = []

      // Auto-confirm a matched NATIVE invoice (by SCOR ref or by message number).
      const applyNative = async (inv, c) => {
        // Lock the invoice + insert + recompute atomically so a re-import or concurrent
        // confirm can't double-count. Settlement is derived from the full ledger.
        const before = inv.status
        const row = await database.transaction(async (trx) => {
          await trx('finance_invoices').where('id', inv.id).forUpdate().first('id')
          await trx('finance_payments').insert(payRow(c, importId, { invoice: inv.id, match_status: 'native', entry_type: 'payment' }))
          return recomputeInvoice(trx, inv.id, { actorName: 'camt import', actorEmail: null, via: 'camt' })
        })
        const after = row?.status
        if (after === 'paid' && before !== 'paid') {
          summary.auto_confirmed++
          details.push({ status: 'auto_confirmed', invoice: inv.number, ...slim(c) })
        } else if (after === 'paid') {
          details.push({ status: 'native_already_settled', invoice: inv.number, invoiceAmount: Number(inv.amount), ...slim(c) })
        } else {
          details.push({ status: 'native_partial', invoice: inv.number, invoiceAmount: Number(inv.amount), ...slim(c) })
        }
      }

      for (const c of parsed.credits) {
        if (!(c.amount > 0)) { summary.skipped++; continue }
        if (c.currency && c.currency !== 'CHF') { summary.skipped++; details.push({ status: 'skipped', reason: 'non-CHF', ...slim(c) }); continue }
        // No stable bank reference → can't dedup a re-import → skip rather than risk
        // double-recording the payment on the next import.
        if (!c.uid) { summary.skipped++; details.push({ status: 'skipped', reason: 'no bank reference', ...slim(c) }); continue }
        if (await database('finance_payments').where('camt_reference', c.uid).first('id')) { summary.duplicates++; continue }

        // 1) native match by SCOR reference (verified against the stored reference)
        const invId = invoiceIdFromScor(c.reference)
        let matched = invId ? await database('finance_invoices').where('id', invId).andWhere('source', 'native').first() : null
        if (matched && norm(matched.reference) !== norm(c.reference)) matched = null
        if (matched) { await applyNative(matched, c); continue }

        // 2) match by invoice NUMBER in the Mitteilung — exactly how ClubDesk reconciles.
        //    Validate candidates against real numbers + amount (guards bare-number noise).
        const cands = invoiceNumbersFromMessage([c.reference, c.unstructured].filter(Boolean).join(' '))
        if (cands.length) {
          const hits = await database('finance_invoices').whereIn('number', cands)
            .orderByRaw("CASE WHEN source='native' THEN 0 ELSE 1 END")
            .limit(8).select('id', 'number', 'amount', 'open_amount', 'status', 'recipient_name', 'source')
          const pick = hits.find((r) => Math.abs(Number(r.amount) - c.amount) < 0.005) || (hits.length === 1 ? hits[0] : null)
          if (pick && pick.source === 'native') {
            const inv = await database('finance_invoices').where('id', pick.id).first()
            await applyNative(inv, c); continue
          }
          if (pick) { // ClubDesk invoice matched by number — confident cross-check, never mutate ClubDesk
            await database('finance_payments').insert(payRow(c, importId, { invoice: null, match_status: 'clubdesk_match', clubdesk_guess: pick.id }))
            summary.clubdesk_guesses++
            details.push({ status: 'clubdesk_match', invoice: pick.number, recipient: pick.recipient_name, invoiceStatus: pick.status, ...slim(c) })
            continue
          }
        }

        // 3) fuzzy ClubDesk guess (amount + payer name, flag only) / 4) unmatched
        const guess = await fuzzyClubdesk(c)
        await database('finance_payments').insert(payRow(c, importId, { invoice: null, match_status: guess ? 'clubdesk_guess' : 'unmatched', clubdesk_guess: guess?.id ?? null }))
        if (guess) { summary.clubdesk_guesses++; details.push({ status: 'clubdesk_guess', invoice: guess.number, recipient: guess.recipient_name, invoiceStatus: guess.status, ...slim(c) }) }
        else { summary.unmatched++; details.push({ status: 'unmatched', ...slim(c) }) }
      }

      await writeUserLog(database, log, { accountability: req.accountability, action: 'create', collection: 'finance_payments', recordId: importId, data: { kind: 'camt_import', ...summary } })
      return res.json({ summary, details })
    } catch (e) {
      log.error({ msg: `finance/camt-import: ${e.message}`, endpoint: 'finance/camt-import', userId: req.accountability?.user || null, stack: e.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // GET /finance/payments — the reconciliation ledger (Vorstand), newest first.
  router.get('/finance/payments', async (req, res) => {
    try {
      const actor = await vorstand(req)
      if (!actor.ok) return res.status(403).json({ error: 'Forbidden' })
      const rows = await database('finance_payments as p')
        .leftJoin('finance_invoices as ni', 'ni.id', 'p.invoice')
        .leftJoin('finance_invoices as cg', 'cg.id', 'p.clubdesk_guess')
        .where('p.method', 'camt')
        .orderBy([{ column: 'p.payment_date', order: 'desc' }, { column: 'p.id', order: 'desc' }])
        .limit(500)
        .select('p.id', 'p.payment_date', 'p.amount', 'p.currency', 'p.reference', 'p.unstructured',
          'p.debtor_name', 'p.match_status', 'ni.number as invoice_number', 'cg.number as guess_number',
          'cg.recipient_name as guess_recipient', 'cg.status as guess_status')
      return res.json({ payments: rows })
    } catch (e) {
      log.error({ msg: `finance/payments: ${e.message}`, stack: e.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })
}
