// Completeness gate for the Data Explorer's member-field taxonomy.
//
// The point of this suite is that `memberFieldSchema.ts` cannot silently fall
// behind the database. A migration that adds a `members` column fails here
// until somebody gives that column a group, a label and — if a cron or a
// trigger writes it — the one-line provenance string the UI shows on its
// Read-only badge. Before the taxonomy existed the explorer guessed the control
// from the value, so a NULL boolean rendered as a text box and the member's
// wrapped private key rendered as a 120-char textarea.

import { describe, it, expect } from 'vitest'
import { MEMBERS_COLUMNS } from './membersColumns.fixture'
import {
  FEE_AMOUNT_VIRTUAL_KEY,
  MEMBER_FIELDS,
  MEMBER_FIELD_GROUPS,
  MEMBER_FIELD_BY_KEY,
  MEMBER_FIELD_OVERWRITTEN_BY,
  MEMBER_FIELD_PROVENANCE,
  NEVER_PATCH_KEYS,
  TEAMS_VIRTUAL_KEY,
  buildMemberFieldSections,
  bulkEditableFields,
  fieldFilterReason,
  getFieldDef,
  isBulkEditable,
  isFieldReadOnly,
  isRelationAlias,
  sanitizeRecord,
  type MemberFieldGroupId,
  type MemberFieldKind,
} from '../memberFieldSchema'
import { MEMBER_FIELD_LABELS } from '../memberFieldLabels'
import { MEMBER_MULTI_FIELDS, MEMBER_SELECT_FIELDS, MEMBER_SUGGEST_FIELDS } from '../memberFieldOptions'

const ALL_KINDS: MemberFieldKind[] = [
  'text', 'longtext', 'number', 'bool', 'date', 'datetime', 'json',
  'select', 'multiselect', 'suggest',
  'email', 'phone', 'ahv', 'iban', 'postalcode', 'photo',
  'team', 'teamMulti', 'countryMulti', 'country',
  'positions', 'trainerLicences', 'readonlyMasked',
]

/**
 * Words that may appear capitalised mid-label. Acronyms and proper nouns only —
 * everything else must be lower case, because CLAUDE.md forbids Title Case for
 * user-facing strings and these labels are user-facing.
 */
const ALLOWED_CAPITALISED = new Set([
  'ClubDesk', 'IBAN', 'AHV', 'CHF', 'VIS', 'OTR', 'OTN', 'FIVB', 'J+S', 'ID', 'UUID',
  'VM', 'KSCW', 'Swiss', 'Volley', 'Basketplan', 'SALTO', 'BASPO', 'Directus',
  'Wiedisync', 'Spielplaner', 'Volleyball', 'Basketball',
])

function midLabelCapitalisedWords(label: string): string[] {
  return label
    .split(/\s+/)
    .slice(1)
    // Strip surrounding punctuation: "(ClubDesk" → "ClubDesk", "official)" → "official".
    .map((w) => w.replace(/^[^A-Za-z0-9+]+/, '').replace(/[^A-Za-z0-9+]+$/, ''))
    .filter((w) => /^[A-Z]/.test(w))
}

describe('memberFieldSchema — completeness', () => {
  it('claims every members column exactly once, plus the two virtual keys', () => {
    const keys = MEMBER_FIELDS.map((f) => f.key)
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
    expect(dupes).toEqual([])

    const expected = [...MEMBERS_COLUMNS, TEAMS_VIRTUAL_KEY, FEE_AMOUNT_VIRTUAL_KEY].sort()
    expect([...keys].sort()).toEqual(expected)
  })

  it('has 111 real columns and 2 virtual fields', () => {
    expect(MEMBERS_COLUMNS).toHaveLength(111)
    expect(MEMBER_FIELDS.filter((f) => !f.virtual)).toHaveLength(111)
    // The roster multiselect writes a junction; the Beitrag card is computed by
    // the server's fee engine. Neither is a `members` column, and neither may
    // ever reach a PATCH body.
    expect(MEMBER_FIELDS.filter((f) => f.virtual).map((f) => f.key))
      .toEqual([TEAMS_VIRTUAL_KEY, FEE_AMOUNT_VIRTUAL_KEY])
  })

  it('puts each column in exactly one declared group', () => {
    const groupIds = new Set(MEMBER_FIELD_GROUPS.map((g) => g.id))
    const seen = new Map<string, MemberFieldGroupId>()
    for (const f of MEMBER_FIELDS) {
      expect(groupIds.has(f.group), `${f.key} → unknown group "${f.group}"`).toBe(true)
      expect(seen.has(f.key), `${f.key} claimed twice`).toBe(false)
      seen.set(f.key, f.group)
    }
    expect(seen.size).toBe(MEMBERS_COLUMNS.length + 2) // + the two virtual keys
  })

  it('matches the group sizes the taxonomy was designed around', () => {
    const count = (id: MemberFieldGroupId) => MEMBER_FIELDS.filter((f) => f.group === id).length
    expect(count('identity')).toBe(11)
    expect(count('contact')).toBe(7)
    expect(count('membership')).toBe(12) // 11 columns + __teams
    expect(count('playing')).toBe(3)
    expect(count('association')).toBe(21)
    expect(count('roles_access')).toBe(3)
    expect(count('finance')).toBe(19) // 18 columns + __fee_amount
    expect(count('privacy')).toBe(6)
    expect(count('notifications')).toBe(11)
    expect(count('clubdesk')).toBe(5)
    expect(count('transfer')).toBe(4)
    expect(count('system')).toBe(11)

    const sub = (id: string) => MEMBER_FIELDS.filter((f) => f.subsection === id).length
    expect(sub('assoc_common')).toBe(7)
    expect(sub('assoc_vb')).toBe(9)
    expect(sub('assoc_bb')).toBe(5)
  })

  it('exposes a MEMBER_FIELD_BY_KEY entry for every field', () => {
    for (const f of MEMBER_FIELDS) expect(MEMBER_FIELD_BY_KEY[f.key]).toBe(f)
  })
})

describe('memberFieldSchema — invariants', () => {
  it('gives every read-only or privileged field a provenance string', () => {
    for (const f of MEMBER_FIELDS) {
      if (f.readOnly || f.privileged) {
        expect(f.provenance?.trim(), `${f.key} has no provenance`).toBeTruthy()
      }
    }
  })

  it('never marks a field both editable-with-a-sync and read-only', () => {
    for (const f of MEMBER_FIELDS) {
      if (f.overwrittenBy) {
        expect(f.readOnly, `${f.key} is read-only AND overwrittenBy`).toBe(false)
      }
    }
  })

  it('renders every sensitive field as a masked, read-only chip', () => {
    const sensitive = MEMBER_FIELDS.filter((f) => f.sensitive)
    expect(sensitive.map((f) => f.key).sort()).toEqual(
      ['e2ee_kdf_salt', 'e2ee_private_key', 'e2ee_public_key', 'ical_token'],
    )
    for (const f of sensitive) {
      expect(f.kind).toBe('readonlyMasked')
      expect(f.readOnly).toBe(true)
    }
  })

  it('makes every danger-zone field read-only in the grid', () => {
    const dz = MEMBER_FIELDS.filter((f) => f.dangerZone)
    expect(dz.map((f) => f.key).sort()).toEqual(
      ['kscw_membership_active', 'shell', 'shell_expires', 'wiedisync_active'],
    )
    for (const f of dz) expect(f.readOnly).toBe(true)
  })

  it('keeps order unique and contiguous from 1 within each group + subsection', () => {
    const buckets = new Map<string, number[]>()
    for (const f of MEMBER_FIELDS) {
      const bucket = `${f.group}/${f.subsection ?? ''}`
      buckets.set(bucket, [...(buckets.get(bucket) ?? []), f.order])
    }
    for (const [bucket, orders] of buckets) {
      const sorted = [...orders].sort((a, b) => a - b)
      const expected = orders.map((_, i) => i + 1)
      expect(sorted, `${bucket} orders are not 1..n`).toEqual(expected)
    }
  })

  it('gates a field on a sport only inside the association group', () => {
    for (const f of MEMBER_FIELDS) {
      if (f.sportGate !== null) expect(f.group, `${f.key}`).toBe('association')
    }
    // …and the gate always agrees with the subsection it lives in.
    for (const f of MEMBER_FIELDS.filter((f) => f.subsection === 'assoc_vb')) {
      expect(f.sportGate).toBe('volleyball')
    }
    for (const f of MEMBER_FIELDS.filter((f) => f.subsection === 'assoc_bb')) {
      expect(f.sportGate).toBe('basketball')
    }
    // J+S is federal, federation-of-origin names both governing bodies, and
    // license_nr holds Swiss Basketball licences as well as Swiss Volley ones —
    // gating any of them to volleyball hides a live field from half the club.
    for (const key of ['js_id', 'federation_of_origin', 'license_nr']) {
      expect(MEMBER_FIELD_BY_KEY[key].subsection).toBe('assoc_common')
      expect(MEMBER_FIELD_BY_KEY[key].sportGate).toBeNull()
    }
  })

  it('uses only the 23 closed editor kinds', () => {
    for (const f of MEMBER_FIELDS) expect(ALL_KINDS).toContain(f.kind)
  })

  it('backs every select / multiselect / suggest field with an option list', () => {
    for (const f of MEMBER_FIELDS) {
      if (f.kind === 'select') expect(MEMBER_SELECT_FIELDS[f.key], f.key).toBeTruthy()
      if (f.kind === 'multiselect') expect(MEMBER_MULTI_FIELDS[f.key], f.key).toBeTruthy()
      if (f.kind === 'suggest') expect(MEMBER_SUGGEST_FIELDS[f.key], f.key).toBeTruthy()
    }
    // …and no option list is orphaned (an option set with no field renders nowhere).
    for (const key of Object.keys(MEMBER_SELECT_FIELDS)) expect(MEMBER_FIELD_BY_KEY[key]?.kind).toBe('select')
    for (const key of Object.keys(MEMBER_MULTI_FIELDS)) expect(MEMBER_FIELD_BY_KEY[key]?.kind).toBe('multiselect')
    for (const key of Object.keys(MEMBER_SUGGEST_FIELDS)) expect(MEMBER_FIELD_BY_KEY[key]?.kind).toBe('suggest')
  })

  it('writes every label and group header in sentence case', () => {
    const labels = [
      ...MEMBER_FIELDS.map((f) => f.label),
      ...MEMBER_FIELD_GROUPS.map((g) => g.label),
      ...MEMBER_FIELD_GROUPS.flatMap((g) => (g.subsections ?? []).map((s) => s.label)).filter(Boolean),
    ]
    for (const label of labels) {
      expect(label.length, 'empty label').toBeGreaterThan(0)
      expect(/^[A-Z]/.test(label), `"${label}" does not start with a capital`).toBe(true)
      for (const word of midLabelCapitalisedWords(label)) {
        expect(ALLOWED_CAPITALISED.has(word), `"${label}" looks Title Case ("${word}")`).toBe(true)
      }
    }
  })

  it('derives the provenance and overwritten-by maps from the defs', () => {
    for (const f of MEMBER_FIELDS) {
      if (f.readOnly || f.privileged) expect(MEMBER_FIELD_PROVENANCE[f.key], f.key).toBeTruthy()
      if (f.overwrittenBy) expect(MEMBER_FIELD_OVERWRITTEN_BY[f.key]).toBe(f.overwrittenBy)
    }
    // A freely editable field claims neither.
    expect(MEMBER_FIELD_PROVENANCE.first_name).toBeUndefined()
    expect(MEMBER_FIELD_OVERWRITTEN_BY.first_name).toBeUndefined()
    // The sync-clobbered ones are documented but NOT locked.
    expect(MEMBER_FIELD_OVERWRITTEN_BY.sektion).toContain('ClubDesk')
    expect(MEMBER_FIELD_PROVENANCE.sektion).toBeUndefined()
  })

  it('never lets a machine-owned key into a PATCH', () => {
    for (const key of ['id', 'uuid', 'date_created', 'ical_token', 'e2ee_private_key', 'shell', TEAMS_VIRTUAL_KEY]) {
      expect(NEVER_PATCH_KEYS.has(key), key).toBe(true)
    }
    // Editable-but-synced fields ARE patchable — the amber chip is a warning,
    // not a lock (vis_player_no is hand-set on purpose).
    for (const key of ['first_name', 'scorer_vb', 'vis_player_no', 'sektion']) {
      expect(NEVER_PATCH_KEYS.has(key), key).toBe(false)
    }
  })
})

describe('isFieldReadOnly', () => {
  const asAdmin = { isGlobalAdmin: true }
  const asSportAdmin = { isGlobalAdmin: false }

  it('locks read-only, sensitive and danger-zone fields for everybody', () => {
    for (const key of ['id', 'nationalitaet', 'ical_token', 'kscw_membership_active']) {
      expect(isFieldReadOnly(MEMBER_FIELD_BY_KEY[key], asAdmin), key).toBe(true)
      expect(isFieldReadOnly(MEMBER_FIELD_BY_KEY[key], asSportAdmin), key).toBe(true)
    }
  })

  it('unlocks privileged fields only for a global admin', () => {
    for (const key of ['role', 'is_spielplaner']) {
      expect(isFieldReadOnly(MEMBER_FIELD_BY_KEY[key], asSportAdmin), key).toBe(true)
      expect(isFieldReadOnly(MEMBER_FIELD_BY_KEY[key], asAdmin), key).toBe(false)
    }
  })

  it('leaves ordinary fields editable', () => {
    expect(isFieldReadOnly(MEMBER_FIELD_BY_KEY.first_name, asSportAdmin)).toBe(false)
  })
})

/**
 * The bulk-edit gate, pinned as an exact list.
 *
 * A snapshot rather than a rule, on purpose: `bulkUnsafe` is opt-in, so a
 * column added by a future migration would default to "yes, write this to 200
 * people at once" and nothing would say so. Pinning the set means the next
 * person to add a member column has to look at their column and decide — which
 * is the whole point, and takes one line either way.
 */
describe('isBulkEditable', () => {
  const asAdmin = { isGlobalAdmin: true }
  const asSportAdmin = { isGlobalAdmin: false }

  /** Fields a bulk action may write. Add a key here ONLY after deciding that one
   *  shared value across several different people can be correct. */
  const BULK_EDITABLE_FOR_ADMIN = [
    // identity
    'anrede', 'sex', 'birthdate_visibility', 'nationalitaet_codes', 'language',
    // contact
    'hide_email', 'hide_phone', 'adresse', 'plz', 'ort',
    // membership
    'sektion', TEAMS_VIRTUAL_KEY, 'requested_team', 'coach_approved_team', 'eintritt',
    // playing
    'position', 'trainer_licences',
    // association
    'federation_of_origin', 'licence_status', 'scorer_vb', 'referee_vb',
    'referee_bb', 'otr1_bb', 'otr2_bb', 'otn1_bb', 'otn2_bb',
    // roles & access (global admin only — see the sport-admin case below)
    'role', 'is_spielplaner',
    // finance
    'beitragskategorie', 'fee_base_override', 'fee_surcharge_override',
    'fee_discount', 'fee_discount_pct', 'fee_discount_reason',
    'iban_confirmed', 'never_dun', 'billing_different', 'billing_name',
    'billing_email', 'billing_address', 'billing_plz', 'billing_ort',
    'billing_phone', 'billing_iban',
    // privacy
    'website_visible', 'website_name_private', 'push_preview_content',
    // notifications
    'communications_team_chat_enabled', 'communications_dm_enabled', 'communications_banned',
    'auto_confirm_trainings', 'auto_confirm_games', 'auto_confirm_events',
    'email_notify_events', 'email_notify_announcements', 'email_notify_registrations',
    'email_notify_join_requests', 'email_notify_form_submissions',
    // clubdesk
    'clubdesk_sync_exclude',
    // transfer
    'transfer_status', 'transfer_note',
  ]

  it('allows exactly the reviewed set for a global admin', () => {
    const actual = bulkEditableFields(asAdmin).map((f) => f.key).sort()
    expect(actual).toEqual([...BULK_EDITABLE_FOR_ADMIN].sort())
  })

  it('withholds the privileged fields from a sport admin', () => {
    const actual = new Set(bulkEditableFields(asSportAdmin).map((f) => f.key))
    expect(actual.has('role')).toBe(false)
    expect(actual.has('is_spielplaner')).toBe(false)
    expect(actual.has('beitragskategorie')).toBe(true)
  })

  it('refuses every field that identifies one person', () => {
    for (const key of [
      'first_name', 'last_name', 'nickname', 'photo', 'birthdate',
      'email', 'phone', 'ahv_nummer', 'iban', 'number', 'js_id', 'vis_player_no',
    ]) {
      expect(isBulkEditable(MEMBER_FIELD_BY_KEY[key], asAdmin), key).toBe(false)
      expect(MEMBER_FIELD_BY_KEY[key].bulkUnsafe, `${key} must say why`).toBeTruthy()
    }
  })

  it('refuses the departure pair — it is the dedicated action, not a field write', () => {
    // The CHECK members_austritt_needs_departed_status refuses an exit date
    // without a departed status, so composing them as two independent field
    // writes fails on the database rather than on screen.
    expect(isBulkEditable(MEMBER_FIELD_BY_KEY.register_status, asAdmin)).toBe(false)
    expect(isBulkEditable(MEMBER_FIELD_BY_KEY.austritt, asAdmin)).toBe(false)
  })

  it('refuses to assert consent on somebody’s behalf', () => {
    expect(isBulkEditable(MEMBER_FIELD_BY_KEY.consent_decision, asAdmin)).toBe(false)
  })

  it('is never wider than the single-member gate', () => {
    for (const def of MEMBER_FIELDS) {
      for (const ctx of [asAdmin, asSportAdmin]) {
        if (!isBulkEditable(def, ctx)) continue
        // The roster is the one virtual key that passes — it writes junction
        // rows, which is why it is bulk-editable and not PATCHable.
        if (def.key === TEAMS_VIRTUAL_KEY) continue
        expect(isFieldReadOnly(def, ctx), `${def.key} is bulk-editable but read-only`).toBe(false)
        expect(NEVER_PATCH_KEYS.has(def.key), `${def.key} is bulk-editable but never-patch`).toBe(false)
      }
    }
  })

  it('gives every excluded-but-editable field a reason to show the operator', () => {
    for (const def of MEMBER_FIELDS) {
      if (!def.bulkUnsafe) continue
      expect(def.bulkUnsafe.length, `${def.key} reason too short`).toBeGreaterThan(20)
    }
  })
})

describe('sanitizeRecord', () => {
  it('replaces every secret with "was it set" and keeps everything else', () => {
    const { record, present } = sanitizeRecord({
      id: 12,
      first_name: 'Anna',
      ical_token: 'c0ffee-real-bearer-token',
      e2ee_private_key: 'wrapped-key-material',
      e2ee_kdf_salt: null,
      e2ee_public_key: '',
    })

    expect(record.first_name).toBe('Anna')
    expect(record.id).toBe(12)

    // The raw values are gone — not truncated, not masked with asterisks, gone.
    expect(record.ical_token).toBe(true)
    expect(record.e2ee_private_key).toBe(true)
    expect(record.e2ee_kdf_salt).toBe(false)
    expect(record.e2ee_public_key).toBe(false)
    expect(JSON.stringify(record)).not.toContain('c0ffee')
    expect(JSON.stringify(record)).not.toContain('wrapped-key-material')

    expect(present).toEqual({
      ical_token: true,
      e2ee_private_key: true,
      e2ee_kdf_salt: false,
      e2ee_public_key: false,
    })
  })

  it('does not invent keys the record never carried', () => {
    const { record, present } = sanitizeRecord({ id: 1 })
    expect(Object.keys(record)).toEqual(['id'])
    expect(present).toEqual({})
  })

  // Deny by default. The declared `sensitive` flags are an allow-list, so a
  // credential column added by a migration this file has not caught up with
  // would otherwise be rendered raw in the amber "Unmapped columns" group.
  it('masks an UNDESCRIBED column whose name reads like key material', () => {
    const { record, present } = sanitizeRecord({
      id: 1,
      webhook_secret: 'sk_live_do_not_render_me',
      refresh_token: 'bearer-value',
      // …while an ordinary new column is still shown as itself.
      favourite_hall: 'KWI',
    })

    expect(record.webhook_secret).toBe(true)
    expect(record.refresh_token).toBe(true)
    expect(record.favourite_hall).toBe('KWI')
    expect(JSON.stringify(record)).not.toContain('sk_live_do_not_render_me')
    expect(present).toEqual({ webhook_secret: true, refresh_token: true })

    // …and the synthesised def renders as the masked chip, never as a text box.
    expect(getFieldDef('webhook_secret').kind).toBe('readonlyMasked')
    expect(getFieldDef('webhook_secret').sensitive).toBe(true)
    expect(getFieldDef('favourite_hall').kind).toBe('text')
    expect(getFieldDef('favourite_hall').sensitive).toBe(false)
  })
})

// Directus o2m aliases arrive on a `fields: ['*']` read looking exactly like
// columns. They surfaced in the amber "Unmapped columns" group on 2026-08-06 and
// were nearly dropped as dead schema — `member_teams` is the entire club roster.
describe('relation aliases are not fields', () => {
  const ALIASES = ['member_teams', 'game_guests', 'spielplaner_assignments']

  it.each(ALIASES)('%s is recognised as an alias, not a column', (key) => {
    expect(isRelationAlias(key)).toBe(true)
  })

  it('treats any Directus field-group header as an alias', () => {
    expect(isRelationAlias('grp_identity')).toBe(true)
    expect(isRelationAlias('grp_anything_added_later')).toBe(true)
  })

  it('does not mistake a real column for an alias', () => {
    for (const key of ['first_name', 'requested_team', 'beitragskategorie', 'iban']) {
      expect(isRelationAlias(key)).toBe(false)
    }
  })

  it('drops aliases from the record so they can never reach a PATCH body', () => {
    const { record, present } = sanitizeRecord({
      id: 1,
      first_name: 'Ada',
      member_teams: [2199],
      game_guests: [],
      spielplaner_assignments: [],
      grp_identity: null,
    })
    for (const key of [...ALIASES, 'grp_identity']) {
      expect(record).not.toHaveProperty(key)
      expect(present).not.toHaveProperty(key)
    }
    expect(record.first_name).toBe('Ada')
  })

  it('never renders an alias as an unmapped column', () => {
    const sections = buildMemberFieldSections({
      presentKeys: ['first_name', ...ALIASES],
      sport: 'both',
      revealedSports: new Set(),
    })
    const rendered = sections.flatMap((s) => s.entries.flatMap((e) => e.fields.map((f) => f.key)))
    for (const key of ALIASES) expect(rendered).not.toContain(key)
    expect(rendered).toContain('first_name')
  })
})

describe('getFieldDef', () => {
  it('returns the declared def for a known column', () => {
    expect(getFieldDef('first_name').group).toBe('identity')
  })

  it('synthesises a locked system-group def for an unmapped column', () => {
    const def = getFieldDef('some_column_added_by_a_future_migration')
    expect(def.group).toBe('system')
    expect(def.label).toBe('Some column added by a future migration')
    expect(def.readOnly).toBe(true)
    expect(def.provenance).toBeTruthy()
    expect(def.help).toContain('Unmapped column')
  })

  it('returns a stable object so React deps do not thrash', () => {
    expect(getFieldDef('another_unmapped_column')).toBe(getFieldDef('another_unmapped_column'))
  })
})

describe('buildMemberFieldSections', () => {
  const allKeys = [...MEMBERS_COLUMNS, TEAMS_VIRTUAL_KEY]
  const none = new Set<'volleyball' | 'basketball'>()

  const keysOf = (sections: ReturnType<typeof buildMemberFieldSections>) =>
    sections.flatMap((s) => s.entries.flatMap((e) => e.fields.map((f) => f.key)))

  it('returns every present key exactly once, hidden ones included', () => {
    const sections = buildMemberFieldSections({ presentKeys: allKeys, sport: 'volleyball', revealedSports: none })
    const keys = keysOf(sections)
    expect([...keys].sort()).toEqual([...allKeys].sort())
  })

  it('only ever returns declared groups, in declared order', () => {
    const sections = buildMemberFieldSections({ presentKeys: allKeys, sport: 'both', revealedSports: none })
    const declared = MEMBER_FIELD_GROUPS.map((g) => g.id)
    expect(sections.map((s) => s.group.id)).toEqual(declared)
  })

  it('drops keys the viewer\'s policy withheld instead of rendering empty cards', () => {
    const sections = buildMemberFieldSections({
      presentKeys: ['id', 'first_name', 'last_name'],
      sport: 'both',
      revealedSports: none,
    })
    expect(keysOf(sections).sort()).toEqual(['first_name', 'id', 'last_name'])
    expect(sections.map((s) => s.group.id)).toEqual(['identity', 'system'])
  })

  it('hides the other sport for a volleyball member and offers the reveal toggle', () => {
    const [assoc] = buildMemberFieldSections({ presentKeys: allKeys, sport: 'volleyball', revealedSports: none })
      .filter((s) => s.group.id === 'association')

    const bySub = new Map(assoc.entries.map((e) => [e.subsection?.id ?? '', e]))
    expect(bySub.get('assoc_common')!.hiddenBySport).toBe(false)
    expect(bySub.get('assoc_vb')!.hiddenBySport).toBe(false)
    expect(bySub.get('assoc_bb')!.hiddenBySport).toBe(true)
    expect(assoc.hasHiddenSport).toBe(true)
    // The hidden block's fields are still returned — hiding is visual only, so
    // a dirty value in there is still counted and still PATCHed.
    expect(bySub.get('assoc_bb')!.fields).toHaveLength(5)
    expect(assoc.visibleCount).toBe(16)
  })

  it('mirrors that for a basketball member', () => {
    const [assoc] = buildMemberFieldSections({ presentKeys: allKeys, sport: 'basketball', revealedSports: none })
      .filter((s) => s.group.id === 'association')
    const bySub = new Map(assoc.entries.map((e) => [e.subsection?.id ?? '', e]))
    expect(bySub.get('assoc_vb')!.hiddenBySport).toBe(true)
    expect(bySub.get('assoc_bb')!.hiddenBySport).toBe(false)
    // 7 common + 5 basketball. The common block carries `license_nr`: Swiss
    // Basketball licences live in that same column, so a basketball member must
    // see their own licence number without revealing the volleyball block.
    expect(assoc.visibleCount).toBe(12)
    expect(bySub.get('assoc_common')!.fields.map((f) => f.key)).toContain('license_nr')
  })

  it('shows both blocks for a club-level member — never neither', () => {
    const [assoc] = buildMemberFieldSections({ presentKeys: allKeys, sport: 'both', revealedSports: none })
      .filter((s) => s.group.id === 'association')
    expect(assoc.entries.every((e) => !e.hiddenBySport)).toBe(true)
    expect(assoc.hasHiddenSport).toBe(false)
    expect(assoc.visibleCount).toBe(21)
  })

  it('un-hides a sport the admin explicitly revealed', () => {
    const [assoc] = buildMemberFieldSections({
      presentKeys: allKeys,
      sport: 'volleyball',
      revealedSports: new Set<'volleyball' | 'basketball'>(['basketball']),
    }).filter((s) => s.group.id === 'association')
    expect(assoc.entries.every((e) => !e.hiddenBySport)).toBe(true)
    expect(assoc.visibleCount).toBe(21)
  })

  it('files an unmapped column under system rather than losing it', () => {
    const sections = buildMemberFieldSections({
      presentKeys: ['first_name', 'brand_new_column'],
      sport: 'both',
      revealedSports: none,
    })
    const system = sections.find((s) => s.group.id === 'system')
    expect(system).toBeTruthy()
    expect(keysOf(sections)).toContain('brand_new_column')
  })

  // ── Noise filters ─────────────────────────────────────────────────────────
  // The two toggles are visual only. What these pin is that they cannot swallow
  // an unsaved edit, cannot make a field unfillable, and cannot disagree with
  // the counts printed on the buttons that reveal them.

  it('leaves every key in place when neither filter is asked for', () => {
    const sections = buildMemberFieldSections({
      presentKeys: allKeys,
      sport: 'both',
      revealedSports: none,
      isEmpty: () => true,
    })
    expect(keysOf(sections).sort()).toEqual([...allKeys].sort())
  })

  it('every technical field is read-only, so hiding one can never hide an editable value', () => {
    const editable = MEMBER_FIELDS.filter((f) => f.technical && !f.readOnly)
    expect(editable.map((f) => f.key)).toEqual([])
  })

  it('drops technical fields — and the whole system group with them', () => {
    const sections = buildMemberFieldSections({
      presentKeys: allKeys,
      sport: 'both',
      revealedSports: none,
      showTechnical: false,
    })
    const keys = keysOf(sections)
    expect(keys).not.toContain('nationalitaet')
    expect(keys).not.toContain('clubdesk_pushed_at')
    expect(keys).toContain('nationalitaet_codes')
    expect(keys).toContain('clubdesk_id')
    expect(sections.map((s) => s.group.id)).not.toContain('system')
  })

  it('drops empty fields but keeps false and 0, which are values', () => {
    // ⚠ Not `phone` / `birthdate` / `email` here — those are privacy-governed
    // and deliberately survive the empty filter (own test below).
    const values: Record<string, unknown> = {
      first_name: 'Aniisanth', last_name: '', number: 0, hide_email: false, ort: null,
    }
    const sections = buildMemberFieldSections({
      presentKeys: Object.keys(values),
      sport: 'both',
      revealedSports: none,
      hideEmpty: true,
      isEmpty: (k) => {
        const v = values[k]
        return v == null || v === '' || (Array.isArray(v) && v.length === 0)
      },
    })
    expect(keysOf(sections).sort()).toEqual(['first_name', 'hide_email', 'number'])
  })

  // Regression, member 536 (2026-08-13): with the empty filter on, an absent
  // `birthdate` vanished while `birthdate_visibility: Hidden` stayed — reading
  // as a birthdate the app was withholding rather than one nobody has entered.
  // The subject of a privacy switch stays on screen, blank, and fillable.
  it('keeps a privacy-governed field even when empty', () => {
    const sections = buildMemberFieldSections({
      presentKeys: ['birthdate', 'birthdate_visibility', 'email', 'hide_email', 'phone', 'hide_phone', 'ort'],
      sport: 'both',
      revealedSports: none,
      hideEmpty: true,
      isEmpty: () => true,
    })
    const keys = keysOf(sections).sort()
    expect(keys).toContain('birthdate')
    expect(keys).toContain('email')
    expect(keys).toContain('phone')
    // The exemption is the pair, not a blanket "keep empties".
    expect(keys).not.toContain('ort')
  })

  it('never filters an `alwaysShow` key — an unsaved edit cannot be swallowed', () => {
    const sections = buildMemberFieldSections({
      presentKeys: ['first_name', 'phone', 'nationalitaet'],
      sport: 'both',
      revealedSports: none,
      hideEmpty: true,
      isEmpty: () => true,
      showTechnical: false,
      alwaysShow: new Set(['phone', 'nationalitaet']),
    })
    expect(keysOf(sections).sort()).toEqual(['nationalitaet', 'phone'])
  })

  // The counts on the two buttons and the fields the render plan drops come from
  // this one predicate, which is what keeps "Show technical (21)" honest.
  describe('fieldFilterReason', () => {
    const technical = MEMBER_FIELD_BY_KEY.nationalitaet
    // ⚠ `phone` no longer works as the "ordinary" field — it is governed by
    // `hide_phone` and is therefore exempt from the empty filter.
    const ordinary = MEMBER_FIELD_BY_KEY.ort
    const governed = MEMBER_FIELD_BY_KEY.birthdate

    it('reports nothing filtered when both flags are off', () => {
      expect(fieldFilterReason(technical, {})).toBeNull()
      expect(fieldFilterReason(ordinary, { isEmpty: () => true })).toBeNull()
    })

    it('attributes a field that is both technical and empty to technical only', () => {
      expect(fieldFilterReason(technical, {
        showTechnical: false, hideEmpty: true, isEmpty: () => true,
      })).toBe('technical')
    })

    it('reports an ordinary empty field as empty', () => {
      expect(fieldFilterReason(ordinary, { hideEmpty: true, isEmpty: () => true })).toBe('empty')
    })

    it('never reports a privacy-governed field as empty', () => {
      expect(fieldFilterReason(governed, { hideEmpty: true, isEmpty: () => true })).toBeNull()
    })

    it('lets alwaysShow beat both flags', () => {
      expect(fieldFilterReason(technical, {
        showTechnical: false, hideEmpty: true, isEmpty: () => true,
        alwaysShow: new Set(['nationalitaet']),
      })).toBeNull()
    })
  })

  it('orders fields inside a group by their declared order', () => {
    const identity = buildMemberFieldSections({ presentKeys: allKeys, sport: 'both', revealedSports: none })
      .find((s) => s.group.id === 'identity')!
    expect(identity.entries[0].fields.map((f) => f.key)).toEqual([
      'first_name', 'last_name', 'nickname', 'anrede', 'photo', 'sex',
      'birthdate', 'birthdate_visibility', 'nationalitaet_codes', 'nationalitaet', 'language',
    ])
  })
})

describe('memberFieldLabels — derived from the schema', () => {
  it('labels every members column', () => {
    for (const col of MEMBERS_COLUMNS) {
      expect(MEMBER_FIELD_LABELS[col], `${col} has no label`).toBeTruthy()
      expect(MEMBER_FIELD_LABELS[col]).toBe(MEMBER_FIELD_BY_KEY[col].label)
    }
  })

  it('keeps the non-column `gast` key the ClubDesk sync-up modal renders', () => {
    expect(MEMBER_FIELD_LABELS.gast).toBe('Guest (ClubDesk)')
  })

  it('drops the six labels whose columns no longer exist', () => {
    for (const dead of [
      'licence_activation_date', 'licence_validation_date',
      'status', 'sort', 'user_created', 'user_updated',
    ]) {
      expect(MEMBER_FIELD_LABELS[dead], dead).toBeUndefined()
    }
  })

  it('does not leak the virtual teams key into the column → label map', () => {
    expect(MEMBER_FIELD_LABELS[TEAMS_VIRTUAL_KEY]).toBeUndefined()
  })
})
