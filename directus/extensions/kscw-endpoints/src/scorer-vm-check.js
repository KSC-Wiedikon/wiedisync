/**
 * Scorer licence cross-check — members.scorer_vb vs Volleymanager's indoorwriter
 * registry vs ClubDesk's `VB SC` licence.
 *
 * WHY THIS EXISTS (2026-07-17)
 * ─────────────────────────────
 * Three registers claim to know who may write a match sheet, and two crons write
 * the same column from different sources:
 *
 *   - `vm-sync-check.mjs` (weekly, Mon 04:00) sets scorer_vb = is_writer, i.e. it
 *     sets TRUE for every VM writer *and clears it* for everyone else it matches.
 *   - `import-clubdesk-csv.mjs` (weekly, Sat 22:00) sets scorer_vb = true for
 *     ClubDesk `VB SC` holders — set-true only (migration 207).
 *
 * They disagree, so the flag oscillates weekly for anyone ClubDesk calls a
 * Schreiber that VM's writer list omits. Confirmed on prod: member 180 was set
 * true on 2026-07-11 and cleared by the VM sync on 2026-07-13 04:00.
 *
 * On the data as of 2026-07-17 the two registers do NOT contradict each other —
 * VM's 109 writers are a strict SUBSET of ClubDesk's 154 `VB SC` holders (no VM
 * writer lacks `VB SC`). VM is incomplete, not disagreeing. This endpoint reports
 * the gap; it deliberately does NOT decide which source wins or fix anything.
 *
 * THE THIRD DIRECTION IS THE POINT. `cd_vb_sc_not_flagged` reads 0 while ClubDesk
 * has last written, and jumps to ~28 the moment the VM sync clears them. Without
 * it, this check would report *fewer* incongruences exactly when data is being
 * destroyed — the same false all-clear the hall audit hit when a 401 let it print
 * "✓ 0/80 mismatches" (DEVLOG 2026-07-16). A detector must get louder, not
 * quieter, when the thing it watches breaks.
 *
 * Read-only: no actor capture needed (CLAUDE.md — reads never need it).
 * Admin-gated: `sv_vm_check` direct read is REVOKED for Members (PERMISSIONS.md
 * :107, asserted by smoke-test.mjs) — never widen this past superGate.
 */

/**
 * Replicates the member→VM match cascade in `vm-sync-check.mjs` EXACTLY:
 * license_nr → email → vm_email → name+birthdate → name-only, where name-only
 * keys that collide across VM rows are dropped so a member never binds to the
 * wrong VM person (vm-sync-check.mjs:644-650).
 *
 * It must stay in step with that script: this check's whole purpose is to predict
 * what the sync will do, so a cascade that drifts from the sync's would report
 * confident nonsense. If you change the matching there, change it here.
 */
const MATCH_CASCADE_SQL = `
  WITH name_collisions AS (
    SELECT lower(btrim(first_name)) || '|' || lower(btrim(last_name)) AS k
    FROM sv_vm_check
    WHERE first_name IS NOT NULL AND last_name IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1
  ),
  m AS (
    SELECT
      mm.id, mm.first_name, mm.last_name, mm.license_nr, mm.email,
      mm.scorer_vb, mm.referee_vb, mm.clubdesk_id,
      COALESCE(
        (SELECT v.id FROM sv_vm_check v
           WHERE v.association_id::text = mm.license_nr::text LIMIT 1),
        (SELECT v.id FROM sv_vm_check v
           WHERE NULLIF(btrim(mm.email), '') IS NOT NULL
             AND lower(btrim(v.email)) = lower(btrim(mm.email)) LIMIT 1),
        (SELECT v.id FROM sv_vm_check v
           WHERE NULLIF(btrim(mm.vm_email), '') IS NOT NULL
             AND lower(btrim(v.email)) = lower(btrim(mm.vm_email)) LIMIT 1),
        (SELECT v.id FROM sv_vm_check v
           WHERE mm.birthdate IS NOT NULL
             AND lower(btrim(v.first_name)) = lower(btrim(mm.first_name))
             AND lower(btrim(v.last_name)) = lower(btrim(mm.last_name))
             AND v.birthday = mm.birthdate LIMIT 1),
        (SELECT v.id FROM sv_vm_check v
           WHERE lower(btrim(v.first_name)) = lower(btrim(mm.first_name))
             AND lower(btrim(v.last_name)) = lower(btrim(mm.last_name))
             AND lower(btrim(v.first_name)) || '|' || lower(btrim(v.last_name))
                 NOT IN (SELECT k FROM name_collisions) LIMIT 1)
      ) AS vm_id
    FROM members mm
  ),
  j AS (
    SELECT m.*, v.is_writer AS vm_is_writer, v.association_id AS vm_assoc_id,
           upper(btrim(coalesce(c.offiziellen_lizenz, ''))) AS cd_lizenz
    FROM m
    LEFT JOIN sv_vm_check v ON v.id = m.vm_id
    LEFT JOIN clubdesk_export c ON btrim(c.clubdesk_id) = btrim(m.clubdesk_id)
  )
`

export function registerScorerVmCheck(router, { database, logger }) {
  const log = logger.child({ endpoint: 'scorer-vm-check' })

  // Mirrors clubdesk-update.js:640. Local by design — the extension has no shared
  // admin guard, and every module closes over its own `database`.
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

  router.get('/admin/scorer-vm-check', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })

      // Direction 1 — flagged as scorer, but VM's writer registry doesn't list them.
      // `cleared_next_sync` is the actionable half: the VM sync only rewrites members
      // it MATCHES, so a member with no VM row keeps the flag indefinitely while a
      // matched non-writer loses it next Monday 04:00.
      const flaggedSql = `${MATCH_CASCADE_SQL}
        SELECT id, first_name, last_name, license_nr, vm_assoc_id, cd_lizenz, referee_vb,
               (vm_id IS NOT NULL) AS in_vm,
               vm_is_writer,
               (vm_id IS NOT NULL AND vm_is_writer = false) AS cleared_next_sync
        FROM j
        WHERE scorer_vb = true AND (vm_id IS NULL OR vm_is_writer = false)
        ORDER BY (vm_id IS NOT NULL AND vm_is_writer = false) DESC, last_name, first_name`

      // Direction 2 — VM says writer, flag missing. Reads 0 while the VM sync is
      // healthy (it sets these true on every run); non-zero means the sync is
      // failing or hasn't run since someone was registered in VM.
      const vmWriterSql = `${MATCH_CASCADE_SQL}
        SELECT id, first_name, last_name, license_nr, vm_assoc_id, cd_lizenz
        FROM j
        WHERE vm_is_writer = true AND scorer_vb IS DISTINCT FROM true
        ORDER BY last_name, first_name`

      // Direction 3 — ClubDesk says VB SC, flag missing. THE DATA-LOSS DETECTOR:
      // 0 today, ~28 once the VM sync clears the ClubDesk-only Schreiber. See header.
      const cdSql = `${MATCH_CASCADE_SQL}
        SELECT id, first_name, last_name, license_nr, vm_assoc_id, cd_lizenz,
               (vm_id IS NOT NULL) AS in_vm, vm_is_writer
        FROM j
        WHERE cd_lizenz = 'VB SC' AND scorer_vb IS DISTINCT FROM true
        ORDER BY last_name, first_name`

      // VM writers that match no member row at all. Not a member-side issue, so it
      // can't ride on `j` (which is members-driven) — it needs its own scan.
      const orphanSql = `${MATCH_CASCADE_SQL}
        SELECT v.association_id, v.first_name, v.last_name
        FROM sv_vm_check v
        WHERE v.is_writer = true AND NOT EXISTS (SELECT 1 FROM j WHERE j.vm_id = v.id)
        ORDER BY v.last_name, v.first_name`

      const summarySql = `${MATCH_CASCADE_SQL}
        SELECT
          (SELECT count(*) FROM members WHERE scorer_vb = true)          AS scorer_vb_total,
          (SELECT count(*) FROM sv_vm_check WHERE is_writer = true)      AS vm_writers,
          (SELECT count(*) FROM j WHERE cd_lizenz = 'VB SC')             AS cd_vb_sc,
          (SELECT max(synced_at) FROM sv_vm_check)                       AS vm_synced_at`

      const [flaggedRes, vmWriterRes, cdRes, orphanRes, summaryRes] = await Promise.all([
        database.raw(flaggedSql),
        database.raw(vmWriterSql),
        database.raw(cdSql),
        database.raw(orphanSql),
        database.raw(summarySql),
      ])

      const name = (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim()

      // Normalize — never leak raw DB rows (clubdesk-update.js:1863 convention).
      const flagged_not_in_vm = flaggedRes.rows.map((r) => ({
        member_id: r.id,
        member_name: name(r),
        license_nr: r.license_nr || null,
        in_vm: r.in_vm === true,
        vm_is_writer: r.vm_is_writer === true,
        clubdesk_lizenz: r.cd_lizenz || null,
        referee_vb: r.referee_vb === true,
        cleared_next_sync: r.cleared_next_sync === true,
      }))

      const vm_writer_not_flagged = vmWriterRes.rows.map((r) => ({
        member_id: r.id,
        member_name: name(r),
        license_nr: r.license_nr || null,
        vm_assoc_id: r.vm_assoc_id || null,
        clubdesk_lizenz: r.cd_lizenz || null,
      }))

      const cd_vb_sc_not_flagged = cdRes.rows.map((r) => ({
        member_id: r.id,
        member_name: name(r),
        license_nr: r.license_nr || null,
        in_vm: r.in_vm === true,
        vm_is_writer: r.vm_is_writer === true,
      }))

      const vm_writer_no_member = orphanRes.rows.map((r) => ({
        vm_assoc_id: r.association_id,
        vm_name: name(r),
      }))

      const s = summaryRes.rows[0] || {}

      return res.json({
        flagged_not_in_vm,
        vm_writer_not_flagged,
        cd_vb_sc_not_flagged,
        vm_writer_no_member,
        summary: {
          scorer_vb_total: Number(s.scorer_vb_total || 0),
          vm_writers: Number(s.vm_writers || 0),
          cd_vb_sc: Number(s.cd_vb_sc || 0),
          cleared_next_sync: flagged_not_in_vm.filter((r) => r.cleared_next_sync).length,
          vm_synced_at: s.vm_synced_at || null,
        },
      })
    } catch (err) {
      log.error({
        msg: `scorer-vm-check: ${err.message}`,
        endpoint: 'scorer-vm-check',
        stack: err.stack,
      })
      return res.status(500).json({ error: 'Internal error' })
    }
  })
}
