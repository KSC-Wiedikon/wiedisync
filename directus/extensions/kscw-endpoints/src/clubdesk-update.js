/**
 * ClubDesk Data Update — sends CSV email to admin when member updates ClubDesk-relevant fields
 * POST /kscw/clubdesk-update — authenticated
 */

import { buildEmailLayout, buildInfoCard, bucketEmailsByLocale } from './email-template.js'
import { writeUserLog } from './activity-log.js'

const OWNER_EMAIL = 'luca.canepa@gmail.com'
const ADMIN_EMAIL = 'kontakt@kscw.ch'

/** Current season in Wiedisync short form, e.g. '2025/26' (matches member_teams.season). June cutover — same as src/utils/dateHelpers.ts. */
function getCurrentSeason() {
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth()
  return m < 5 ? `${y - 1}/${String(y).slice(2)}` : `${y}/${String(y + 1).slice(2)}`
}

/** Per-locale display labels for DB field names */
const FIELD_LABELS = {
  de: {
    first_name: 'Vorname', last_name: 'Nachname', email: 'E-Mail', phone: 'Telefon',
    birthdate: 'Geburtsdatum', anrede: 'Anrede', adresse: 'Adresse', plz: 'PLZ', ort: 'Ort',
    nationalitaet: 'Nationalität', sex: 'Geschlecht', ahv_nummer: 'AHV-Nummer',
  },
  gsw: {
    first_name: 'Vorname', last_name: 'Nachname', email: 'E-Mail', phone: 'Telefon',
    birthdate: 'Geburtsdatum', anrede: 'Aaräde', adresse: 'Adrässe', plz: 'PLZ', ort: 'Ort',
    nationalitaet: 'Nationalität', sex: 'Gschlächt', ahv_nummer: 'AHV-Nummer',
  },
  en: {
    first_name: 'First name', last_name: 'Last name', email: 'Email', phone: 'Phone',
    birthdate: 'Date of birth', anrede: 'Salutation', adresse: 'Address', plz: 'Zip', ort: 'City',
    nationalitaet: 'Nationality', sex: 'Sex', ahv_nummer: 'AHV number',
  },
  fr: {
    first_name: 'Prénom', last_name: 'Nom', email: 'E-mail', phone: 'Téléphone',
    birthdate: 'Date de naissance', anrede: 'Salutation', adresse: 'Adresse', plz: 'NPA', ort: 'Localité',
    nationalitaet: 'Nationalité', sex: 'Sexe', ahv_nummer: "Numéro d'AVS",
  },
  it: {
    first_name: 'Nome', last_name: 'Cognome', email: 'E-mail', phone: 'Telefono',
    birthdate: 'Data di nascita', anrede: 'Appellativo', adresse: 'Indirizzo', plz: 'CAP', ort: 'Località',
    nationalitaet: 'Nazionalità', sex: 'Sesso', ahv_nummer: 'Numero AVS',
  },
}

const T = {
  de: {
    title: 'ClubDesk Datenanpassung',
    subject: name => `[KSCW] Datenanpassung: ${name}`,
    intro: 'Folgende Daten wurden vom Mitglied aktualisiert und müssen in ClubDesk übernommen werden:',
    currentData: 'Aktuelle Daten',
    name: 'Name', email: 'E-Mail', phone: 'Telefon', team: 'Team',
    field: 'Feld', oldValue: 'Alt', newValue: 'Neu',
  },
  gsw: {
    title: 'ClubDesk Datenaapassig',
    subject: name => `[KSCW] Datenaapassig: ${name}`,
    intro: 'Folgendi Date sind vom Mitglied aktualisiert worde und müend i ClubDesk übernoh werde:',
    currentData: 'Aktuelli Date',
    name: 'Name', email: 'E-Mail', phone: 'Telefon', team: 'Team',
    field: 'Fäld', oldValue: 'Alt', newValue: 'Neu',
  },
  en: {
    title: 'ClubDesk Data Update',
    subject: name => `[KSCW] Data update: ${name}`,
    intro: 'The following data was updated by the member and needs to be applied in ClubDesk:',
    currentData: 'Current data',
    name: 'Name', email: 'Email', phone: 'Phone', team: 'Team',
    field: 'Field', oldValue: 'Old', newValue: 'New',
  },
  fr: {
    title: 'Mise à jour ClubDesk',
    subject: name => `[KSCW] Mise à jour : ${name}`,
    intro: "Les données suivantes ont été mises à jour par le membre et doivent être reportées dans ClubDesk :",
    currentData: 'Données actuelles',
    name: 'Nom', email: 'E-mail', phone: 'Téléphone', team: 'Équipe',
    field: 'Champ', oldValue: 'Ancien', newValue: 'Nouveau',
  },
  it: {
    title: 'Aggiornamento ClubDesk',
    subject: name => `[KSCW] Aggiornamento: ${name}`,
    intro: 'I seguenti dati sono stati aggiornati dal socio e devono essere riportati in ClubDesk:',
    currentData: 'Dati attuali',
    name: 'Nome', email: 'E-mail', phone: 'Telefono', team: 'Squadra',
    field: 'Campo', oldValue: 'Vecchio', newValue: 'Nuovo',
  },
}

const CD_LOCALES = ['de', 'gsw', 'en', 'fr', 'it']

const CSV_HEADERS = [
  'Anrede', 'Vorname', 'Nachname', 'E-Mail', 'Telefon',
  'Adresse', 'PLZ', 'Ort', 'Geburtsdatum', 'Nationalität',
  'Geschlecht', 'AHV', 'Team', 'Beitragskategorie',
]

function escCsv(val) {
  let s = String(val ?? '')
  // Neutralize spreadsheet formula injection: a cell that starts with =, +, -,
  // @ (or a tab/CR) is interpreted as a formula by Excel/ClubDesk. These CSVs
  // carry member-controlled fields, so prefix such cells with a single quote to
  // force literal text before applying the usual quoting.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s
}

function buildCsv(data, teamNames) {
  const row = [
    data.anrede, data.first_name, data.last_name, data.email, data.phone,
    data.adresse, data.plz, data.ort, data.birthdate, data.nationalitaet,
    data.sex, data.ahv_nummer, teamNames, data.beitragskategorie,
  ]
  return CSV_HEADERS.join(',') + '\n' + row.map(escCsv).join(',')
}

// ── Sync-up push CSV (member → ClubDesk import) ─────────────────────────────
// Headers are the EXACT ClubDesk field names so the import wizard auto-maps every
// column (verified live 2026-06-27 — "Telefon Privat" not "Telefon", "AHV Nummer"
// not "AHV-Nummer"). Semicolon-delimited (ClubDesk's import default). CONTACT
// fields only — never groups/teams/membership category (ClubDesk-managed).
const CD_PUSH_HEADERS = [
  'Anrede', 'Vorname', 'Nachname', 'E-Mail', 'Telefon Privat', 'Adresse',
  'PLZ', 'Ort', 'Geburtsdatum', 'Nationalität', 'Geschlecht', 'AHV Nummer',
]

function fmtBirthdateDDMMYYYY(v) {
  if (!v) return ''
  const iso = (v instanceof Date) ? v.toISOString().slice(0, 10) : String(v)
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

// Semicolon-CSV cell: neutralise spreadsheet-formula injection, then quote.
function cdCell(val) {
  let s = String(val ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return (s.includes(';') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s
}

function buildPushCsv(members) {
  const rows = members.map((m) => [
    m.anrede, m.first_name, m.last_name, m.email, m.phone, m.adresse, m.plz, m.ort,
    fmtBirthdateDDMMYYYY(m.birthdate), m.nationalitaet,
    m.sex === 'm' ? 'männlich' : m.sex === 'f' ? 'weiblich' : '', m.ahv_nummer,
  ].map(cdCell).join(';'))
  return CD_PUSH_HEADERS.join(';') + '\n' + rows.join('\n') + '\n'
}

// Member fields the push CSV reads (also the preview fetch set).
const PUSH_FIELDS = [
  'id', 'anrede', 'first_name', 'last_name', 'email', 'phone', 'adresse', 'plz',
  'ort', 'birthdate', 'nationalitaet', 'sex', 'ahv_nummer', 'clubdesk_id', 'clubdesk_push_changes',
]

// Escape user-controlled strings before interpolating into the admin email
// body. Without this, a member could submit `<img src=x onerror=…>` as one of
// the changed values and the admin's webmail client would render the payload.
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildChangesTable(changes, locale = 'de') {
  const labels = FIELD_LABELS[locale] || FIELD_LABELS.de
  const t = T[locale] || T.de
  const rows = changes.map(c => {
    const label = labels[c.field] || c.field
    const oldVal = c.old_value ? escHtml(c.old_value) : '—'
    const newVal = c.new_value ? escHtml(c.new_value) : '—'
    return `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #334155;color:#e2e8f0;font-size:13px">${escHtml(label)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #334155;color:#ef4444;font-size:13px;text-decoration:line-through">${oldVal}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #334155;color:#22c55e;font-size:13px">${newVal}</td>
    </tr>`
  }).join('')

  return `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid #334155;border-radius:8px;overflow:hidden;margin:12px 0">
  <tr>
    <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #334155">${t.field}</th>
    <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #334155">${t.oldValue}</th>
    <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #334155">${t.newValue}</th>
  </tr>
  ${rows}
</table>`
}

export function registerClubdeskUpdate(router, { database, logger, services, getSchema }) {
  const log = logger.child({ endpoint: 'clubdesk-update' })

  // ── Superadmin gate (ClubDesk member sync is a top-tier, club-wide action) ──
  // Directus admins pass straight through; otherwise the caller must hold the
  // 'superuser' or 'admin' member role. Mirrors finance-ledger.js gate(), tighter.
  async function superGate(req) {
    if (req.accountability?.admin) return true
    const userId = req.accountability?.user
    if (!userId) return false
    const m = await database('members').where('user', userId).first('role')
    if (!m) return false
    const roles = Array.isArray(m.role)
      ? m.role
      : (m.role ? (() => { try { return JSON.parse(m.role) } catch { return [] } })() : [])
    return ['superuser', 'admin'].some((r) => roles.includes(r))
  }

  // ── On-demand ClubDesk MEMBER sync (superadmin "Sync down" button) ──────────
  // POST sets a request flag on the singleton clubdesk_member_sync row; a host
  // dispatcher cron (clubdesk-member-dispatch.sh) claims it, runs clubdesk-sync.sh,
  // and writes back down_state. GET is polled by the button. Sync-up lands later.
  router.get('/clubdesk-member-sync', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const s = await database('clubdesk_member_sync').where('id', 1)
        .first('down_state', 'down_message', 'down_requested_at', 'down_finished_at')
      return res.json({
        state: s?.down_state || 'idle',
        message: s?.down_message || null,
        requested_at: s?.down_requested_at || null,
        finished_at: s?.down_finished_at || null,
      })
    } catch (err) {
      log.error({ msg: `clubdesk-member-sync status: ${err.message}`, endpoint: 'clubdesk-member-sync', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  router.post('/clubdesk-member-sync', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const s = await database('clubdesk_member_sync').where('id', 1).first('down_state')
      if (['queued', 'running'].includes(s?.down_state)) {
        return res.status(409).json({ error: 'A sync is already in progress', state: s.down_state })
      }
      await database('clubdesk_member_sync').where('id', 1).update({
        down_requested_at: new Date(), down_state: 'queued', down_message: null, down_finished_at: null,
      })
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'update',
        collection: 'clubdesk_member_sync', recordId: 1, data: { kind: 'clubdesk_member_sync_request', direction: 'down' },
      })
      return res.json({ state: 'queued' })
    } catch (err) {
      log.error({ msg: `clubdesk-member-sync trigger: ${err.message}`, endpoint: 'clubdesk-member-sync', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Sync-UP: preview what would be pushed to ClubDesk ───────────────────────
  // changed  = members edited in wiedisync since the last push AND linked to a
  //            ClubDesk contact (clubdesk_id) → ClubDesk will UPDATE them.
  // unlinked = members with no clubdesk_id (new registrations + divergent-email /
  //            non-member rows) → the superadmin decides per-member whether to
  //            create them (a divergent-email member would otherwise duplicate).
  router.get('/clubdesk-member-sync/up-preview', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const changedRows = await database('members')
        .where('clubdesk_push_pending', true).whereNotNull('clubdesk_id')
        .select('id', 'first_name', 'last_name', 'email', 'clubdesk_id', 'clubdesk_push_changes')
        .orderBy('last_name')
      const changed = changedRows.map((m) => {
        let changes = []
        try { changes = Array.isArray(m.clubdesk_push_changes) ? m.clubdesk_push_changes : (m.clubdesk_push_changes ? JSON.parse(m.clubdesk_push_changes) : []) } catch { changes = [] }
        return { id: m.id, first_name: m.first_name, last_name: m.last_name, email: m.email, clubdesk_id: m.clubdesk_id, changes }
      })
      const unlinkedRows = await database('members')
        .whereNull('clubdesk_id')
        .select('id', 'first_name', 'last_name', 'email')
        .orderBy('last_name')
      const unlinked = unlinkedRows.map((m) => {
        const e = (m.email || '').toLowerCase()
        const likelyNonMember = e.includes('@kscw.clubdesk.com') || e.startsWith('system@') || e.endsWith('@kscw.ch')
        return { id: m.id, first_name: m.first_name, last_name: m.last_name, email: m.email, likely_non_member: likelyNonMember }
      })
      return res.json({ changed, unlinked })
    } catch (err) {
      log.error({ msg: `up-preview: ${err.message}`, endpoint: 'clubdesk-member-sync/up-preview', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Sync-UP: commit — stash the approved CSV + member ids, enqueue the push ──
  // The host up-dispatcher reads up_csv, runs the import scraper (commit), clears
  // clubdesk_push_pending for up_member_ids, and writes up_result.
  router.post('/clubdesk-member-sync/up', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const ids = Array.isArray(req.body?.member_ids) ? req.body.member_ids.map(Number).filter((n) => Number.isInteger(n)) : []
      if (!ids.length) return res.status(400).json({ error: 'member_ids required' })
      const s = await database('clubdesk_member_sync').where('id', 1).first('up_state')
      if (['queued', 'running'].includes(s?.up_state)) {
        return res.status(409).json({ error: 'A sync-up is already in progress', state: s.up_state })
      }
      const members = await database('members').whereIn('id', ids).select(PUSH_FIELDS)
      if (!members.length) return res.status(400).json({ error: 'No matching members' })
      const csv = buildPushCsv(members)
      await database('clubdesk_member_sync').where('id', 1).update({
        up_requested_at: new Date(), up_state: 'queued', up_message: null, up_finished_at: null,
        up_csv: csv, up_member_ids: JSON.stringify(members.map((m) => m.id)), up_result: null,
      })
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'update',
        collection: 'clubdesk_member_sync', recordId: 1,
        data: { kind: 'clubdesk_member_sync_request', direction: 'up', member_count: members.length },
      })
      return res.json({ state: 'queued', count: members.length })
    } catch (err) {
      log.error({ msg: `up-commit: ${err.message}`, endpoint: 'clubdesk-member-sync/up', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  router.get('/clubdesk-member-sync/up-status', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const s = await database('clubdesk_member_sync').where('id', 1)
        .first('up_state', 'up_message', 'up_requested_at', 'up_finished_at', 'up_result')
      let result = null
      try { result = s?.up_result ? (typeof s.up_result === 'object' ? s.up_result : JSON.parse(s.up_result)) : null } catch { result = null }
      return res.json({
        state: s?.up_state || 'idle',
        message: s?.up_message || null,
        requested_at: s?.up_requested_at || null,
        finished_at: s?.up_finished_at || null,
        result,
      })
    } catch (err) {
      log.error({ msg: `up-status: ${err.message}`, endpoint: 'clubdesk-member-sync/up-status', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Name-only ClubDesk matches (Data Health manual-link check) ──────────────
  // Members whose first+last name matches a ClubDesk contact but whose email AND
  // licence both DIVERGE — so the automatic linker (licence / email+name) can't
  // safely link them. Surfaced in Data Health for a human to confirm: link sets
  // clubdesk_id and stores the ClubDesk email as a secondary (vm_email). If the
  // matched ClubDesk contact is already linked to a DIFFERENT member, it's a
  // likely duplicate-member case (needs a merge, not a link) — flagged, not
  // offered as a one-click link. clubdesk_export is a staging table not exposed
  // via the items API, so this join lives server-side. Superadmin only.
  router.get('/clubdesk-name-matches', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const rows = await database
        .select(
          'm.id as member_id', 'm.first_name', 'm.last_name', 'm.email as member_email',
          'cd.clubdesk_id', 'cd.email as cd_email', 'cd.email_alternativ as cd_email_alt',
          'cd.lizenznummer as cd_lic', 'linked.id as linked_member_id',
          'linked.first_name as linked_first', 'linked.last_name as linked_last',
        )
        .from('members as m')
        .join('clubdesk_export as cd', function () {
          this.on(database.raw('LOWER(BTRIM(cd.vorname)) = LOWER(BTRIM(m.first_name))'))
            .andOn(database.raw('LOWER(BTRIM(cd.nachname)) = LOWER(BTRIM(m.last_name))'))
            .andOn(database.raw("NULLIF(BTRIM(cd.clubdesk_id), '') IS NOT NULL"))
        })
        .leftJoin('members as linked', database.raw('linked.clubdesk_id = BTRIM(cd.clubdesk_id)'))
        .whereNull('m.clubdesk_id')
        .andWhereRaw("LOWER(BTRIM(m.email)) NOT IN (LOWER(BTRIM(cd.email)), LOWER(BTRIM(COALESCE(cd.email_alternativ,''))))")
        .andWhereRaw("(NULLIF(BTRIM(m.license_nr),'') IS NULL OR LOWER(BTRIM(m.license_nr)) <> LOWER(BTRIM(COALESCE(cd.lizenznummer,''))))")
        .orderBy(['m.last_name', 'm.first_name'])
      const candidates = rows.map((r) => ({
        member_id: r.member_id,
        member_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
        member_email: r.member_email,
        clubdesk_id: String(r.clubdesk_id).trim(),
        clubdesk_email: r.cd_email || r.cd_email_alt || null,
        clubdesk_licence: r.cd_lic || null,
        // When set, the ClubDesk contact is already linked to another member →
        // duplicate, needs a merge (no one-click link).
        duplicate_of: r.linked_member_id
          ? { id: r.linked_member_id, name: `${r.linked_first || ''} ${r.linked_last || ''}`.trim() }
          : null,
      }))
      return res.json({ candidates })
    } catch (err) {
      log.error({ msg: `clubdesk-name-matches: ${err.message}`, endpoint: 'clubdesk-name-matches', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // Confirm a name-only match: set the member's clubdesk_id and keep the ClubDesk
  // email as a secondary (vm_email, fill-only). Refuses if the ClubDesk contact is
  // already linked to another member (that's a merge, handled elsewhere).
  router.post('/clubdesk-link', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const memberId = Number(req.body?.member_id)
      const clubdeskId = String(req.body?.clubdesk_id || '').trim()
      if (!Number.isInteger(memberId) || !clubdeskId) {
        return res.status(400).json({ error: 'member_id and clubdesk_id required' })
      }
      const member = await database('members').where('id', memberId).first('id', 'clubdesk_id', 'vm_email', 'email')
      if (!member) return res.status(404).json({ error: 'Member not found' })
      if (member.clubdesk_id) return res.status(409).json({ error: 'Member already linked' })
      const taken = await database('members').where('clubdesk_id', clubdeskId).whereNot('id', memberId).first('id')
      if (taken) return res.status(409).json({ error: 'ClubDesk contact already linked to another member', code: 'duplicate' })
      const cd = await database('clubdesk_export').whereRaw('BTRIM(clubdesk_id) = ?', [clubdeskId])
        .first('email', 'email_alternativ')
      const cdEmail = (cd?.email || cd?.email_alternativ || '').trim() || null
      const patch = { clubdesk_id: clubdeskId }
      // Keep the ClubDesk email as secondary unless the member already has a
      // distinct one. Never overwrite their primary.
      if (cdEmail && (!member.vm_email || member.vm_email.toLowerCase() === (member.email || '').toLowerCase())) {
        patch.vm_email = cdEmail
      }
      await database('members').where('id', memberId).update(patch)
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'update',
        collection: 'members', recordId: memberId,
        data: { kind: 'clubdesk_link', clubdesk_id: clubdeskId, vm_email: patch.vm_email || null },
      })
      return res.json({ success: true, member_id: memberId, clubdesk_id: clubdeskId, vm_email: patch.vm_email || null })
    } catch (err) {
      log.error({ msg: `clubdesk-link: ${err.message}`, endpoint: 'clubdesk-link', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  router.post('/clubdesk-update', async (req, res) => {
    try {
      // Auth check
      const userId = req.accountability?.user
      if (!userId) return res.status(401).json({ error: 'Authentication required' })

      const { member_id, changes, current_data } = req.body
      if (!member_id || !changes?.length || !current_data) {
        return res.status(400).json({ error: 'member_id, changes, current_data required' })
      }

      // Verify ownership: accountability.user is Directus user ID, member_id is members collection ID
      const member = await database('members').where('user', userId).select('id').first()
      if (!member || String(member.id) !== String(member_id)) {
        return res.status(403).json({ error: 'Forbidden' })
      }

      // Get team names for CSV
      const schema = await getSchema()
      const { ItemsService, MailService } = services
      const mtService = new ItemsService('member_teams', { schema, knex: database })
      const memberTeams = await mtService.readByQuery({
        filter: { member: { _eq: member_id }, season: { _eq: getCurrentSeason() } },
        fields: ['team.name', 'team.sport'],
      })
      // Dedupe by team name (defensive — a member can hold the same team across
      // multiple seasons; the season filter already scopes to the current one).
      const teamNames = [...new Set(
        memberTeams.map(mt => mt.team?.name).filter(Boolean)
      )].join(', ')

      // Determine sport for email accent
      const teamSports = memberTeams.map(mt => mt.team?.sport).filter(Boolean)
      const sport = teamSports.includes('volleyball') ? 'volleyball'
        : teamSports.includes('basketball') ? 'basketball' : null

      // Build email — per-recipient locale via members.language
      const name = `${current_data.first_name} ${current_data.last_name}`
      const csvString = buildCsv(current_data, teamNames)
      const dateStr = new Date().toISOString().slice(0, 10)
      const filename = `clubdesk-update-${current_data.last_name}-${current_data.first_name}-${dateStr}.csv`

      const mail = new MailService({ schema, knex: database })

      // OWNER_EMAIL is a real admin's mailbox (resolves via members.language).
      // ADMIN_EMAIL is a forwarding alias (kontakt@kscw.ch) without a member
      // record, so the bucketing helper would fall it into `de`. To prevent
      // a duplicate German copy reaching the same admin via the alias, we
      // mirror ADMIN_EMAIL into the same locale bucket as OWNER_EMAIL.
      const ownerBuckets = await bucketEmailsByLocale(database, [OWNER_EMAIL])
      const ownerLocale = CD_LOCALES.find(l => ownerBuckets[l].length) || 'de'
      const buckets = await bucketEmailsByLocale(database, [OWNER_EMAIL])
      // Add ADMIN_EMAIL to the owner's resolved bucket (deduplicated)
      const adminLower = ADMIN_EMAIL.toLowerCase()
      if (adminLower !== OWNER_EMAIL.toLowerCase() && !buckets[ownerLocale].includes(adminLower)) {
        buckets[ownerLocale].push(adminLower)
      }

      for (const loc of CD_LOCALES) {
        const tos = buckets[loc]
        if (!tos.length) continue
        const tt = T[loc] || T.de
        const summaryCard = buildInfoCard([
          { label: tt.name, value: name, halfWidth: true },
          { label: tt.email, value: current_data.email, halfWidth: true },
          { label: tt.phone, value: current_data.phone || '—', halfWidth: true },
          { label: tt.team, value: teamNames || '—', halfWidth: true },
        ])
        const body = `
<div style="font-size:13px;color:#94a3b8;margin-bottom:12px">${tt.intro}</div>
${buildChangesTable(changes, loc)}
<div style="margin-top:16px">
  <div style="font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;margin-bottom:8px;font-weight:700">${tt.currentData}</div>
  ${summaryCard}
</div>`
        const emailHtml = buildEmailLayout(body, { title: tt.title, subtitle: name, sport })
        await mail.send({
          to: tos,
          subject: tt.subject(name),
          html: emailHtml,
          attachments: [{ filename, content: csvString, contentType: 'text/csv' }],
        })
      }

      // Flag the member for the next ClubDesk sync-up push and remember the field
      // diff (the superadmin modal echoes it). The email-to-admin path stays as the
      // manual fallback; the flag enables the automated push. Best-effort — a flag
      // failure must not fail the member's edit.
      try {
        await database('members').where('id', member_id).update({
          clubdesk_push_pending: true,
          clubdesk_push_changes: JSON.stringify(changes),
        })
      } catch (flagErr) {
        log.warn({ msg: `clubdesk push-flag failed: ${flagErr.message}`, member_id })
      }

      log.info({ msg: 'ClubDesk update email sent', member_id, changes: changes.length })
      res.json({ success: true })
    } catch (err) {
      log.error({
        msg: `clubdesk-update: ${err.message}`,
        endpoint: 'clubdesk-update',
        stack: err.stack,
      })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
