// src/modules/admin/components/ExplorerMemberFilters.tsx
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Filter, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover'
import type { MemberPosition } from '../../../types'
import { TRAINER_LICENCE_CODES, TRAINER_LICENCE_I18N_KEYS } from '../../../utils/trainerLicences'
import {
  BIRTHDATE_VIS,
  BOOL_FIELDS,
  CONSENT_KEYS,
  EMPTY_FILTERS,
  LANGUAGES,
  LICENCE_TYPES,
  POSITIONS,
  PRESENCE_FIELDS,
  ROLE_TYPES,
  countActiveFilters,
  type BoolField,
  type MemberFilterState,
  type PresenceField,
  type SportKey,
  type Tri,
} from './memberFilters'

// ── UI ─────────────────────────────────────────────────────────────────

interface Props {
  value: MemberFilterState
  onChange: (next: MemberFilterState) => void
}

export default function ExplorerMemberFilters({ value, onChange }: Props) {
  const { t } = useTranslation(['admin', 'common', 'invitations', 'teams', 'auth'])
  const activeCount = countActiveFilters(value)

  const setBool = (field: BoolField, tri: Tri) =>
    onChange({
      ...value,
      bools: tri === 'any' ? omitKey(value.bools, field) : { ...value.bools, [field]: tri },
    })

  const setPresence = (field: PresenceField, tri: Tri) =>
    onChange({
      ...value,
      presence: tri === 'any' ? omitKey(value.presence, field) : { ...value.presence, [field]: tri },
    })

  const toggleIn = <T extends string>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]

  const boolLabels = useMemo<Record<BoolField, string>>(
    () => ({
      kscw_membership_active: t('memberFilterKscwActive'),
      wiedisync_active: t('memberFilterWiedisyncActive'),
      shell: t('memberFilterShell'),
      shell_reminder_sent: t('memberFilterShellReminderSent'),
      coach_approved_team: t('memberFilterCoachApprovedTeam'),
      is_spielplaner: t('memberFilterSpielplaner'),
      licence_activated: t('memberFilterLicenceActivated'),
      licence_validated: t('memberFilterLicenceValidated'),
      hide_phone: t('memberFilterHidePhone'),
      hide_email: t('memberFilterHideEmail'),
      website_visible: t('memberFilterWebsiteVisible'),
      communications_team_chat_enabled: t('memberFilterCommsTeamChat'),
      communications_dm_enabled: t('memberFilterCommsDm'),
      communications_banned: t('memberFilterCommsBanned'),
      push_preview_content: t('memberFilterPushPreview'),
    }),
    [t],
  )
  const presenceLabels = useMemo<Record<PresenceField, string>>(
    () => ({
      email: t('memberFilterHasEmail'),
      phone: t('memberFilterHasPhone'),
      license_nr: t('memberFilterHasLicenceNr'),
      number: t('memberFilterHasJerseyNumber'),
      photo: t('memberFilterHasPhoto'),
      birthdate: t('memberFilterHasBirthdate'),
      user: t('memberFilterHasAuthAccount'),
      requested_team: t('memberFilterHasRequestedTeam'),
      adresse: t('memberFilterHasAddress'),
      plz: t('memberFilterHasPlz'),
      ort: t('memberFilterHasCity'),
      nationalitaet_codes: t('memberFilterHasNationality'),
      federation_of_origin: t('memberFilterHasFederation'),
      vm_email: t('memberFilterHasVmEmail'),
      ahv_nummer: t('memberFilterHasAhv'),
      licence_category: t('memberFilterHasLicenceCategory'),
      beitragskategorie: t('memberFilterHasFeeCategory'),
      shell_expires: t('memberFilterHasShellExpiry'),
      last_online_at: t('memberFilterHasLastOnline'),
      consent_prompted_at: t('memberFilterHasConsentPromptedAt'),
    }),
    [t],
  )

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={
            'relative inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted ' +
            (activeCount > 0
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-card text-foreground')
          }
          title={t('memberFilterTitle')}
        >
          <Filter className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t('memberFilterButton')}</span>
          {activeCount > 0 && (
            <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground">
              {activeCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[360px] max-h-[75vh] overflow-y-auto p-3 sm:w-[420px]"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('memberFilterTitle')}</h2>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTERS)}
              className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-destructive"
            >
              <X className="h-3 w-3" /> {t('memberFilterReset')}
            </button>
          )}
        </div>

        <Section title={t('memberFilterSectionSport')}>
          <PillRow>
            {(['volleyball', 'basketball', 'other'] as SportKey[]).map((s) => (
              <Pill
                key={s}
                active={value.sports.includes(s)}
                onClick={() => onChange({ ...value, sports: toggleIn(value.sports, s) })}
                label={
                  s === 'volleyball'
                    ? t('common:volleyball')
                    : s === 'basketball'
                      ? t('common:basketball')
                      : t('explorerSportOther')
                }
              />
            ))}
          </PillRow>
        </Section>

        <Section title={t('memberFilterSectionGender')}>
          <PillRow>
            <Pill
              active={value.sex.includes('m')}
              onClick={() => onChange({ ...value, sex: toggleIn(value.sex, 'm') })}
              label={t('explorerSexMale')}
            />
            <Pill
              active={value.sex.includes('f')}
              onClick={() => onChange({ ...value, sex: toggleIn(value.sex, 'f') })}
              label={t('explorerSexFemale')}
            />
            <Pill
              active={value.sex.includes('other')}
              onClick={() => onChange({ ...value, sex: toggleIn(value.sex, 'other') })}
              label={t('explorerSportOther')}
            />
          </PillRow>
        </Section>

        <Section title={t('memberFilterSectionPositions')}>
          <PillRow>
            {POSITIONS.map((p) => (
              <Pill
                key={p}
                active={value.positions.includes(p)}
                onClick={() => onChange({ ...value, positions: toggleIn(value.positions, p) })}
                label={t(`teams:${positionKey(p)}` as const, p)}
              />
            ))}
          </PillRow>
        </Section>

        <Section title={t('memberFilterSectionLicences')}>
          <PillRow>
            {LICENCE_TYPES.map((l) => (
              <Pill
                key={l}
                active={value.licences.includes(l)}
                onClick={() => onChange({ ...value, licences: toggleIn(value.licences, l) })}
                label={t(`invitations:role_${l}` as const)}
              />
            ))}
          </PillRow>
        </Section>

        <Section title={t('memberFilterSectionTrainerLicences')}>
          <PillRow>
            {TRAINER_LICENCE_CODES.map((c) => (
              <Pill
                key={c}
                active={value.trainerLicences.includes(c)}
                onClick={() => onChange({ ...value, trainerLicences: toggleIn(value.trainerLicences, c) })}
                label={t(`auth:${TRAINER_LICENCE_I18N_KEYS[c]}`)}
              />
            ))}
          </PillRow>
        </Section>

        <Section title={t('memberFilterSectionRoles')}>
          <PillRow>
            {ROLE_TYPES.map((r) => (
              <Pill
                key={r}
                active={value.roles.includes(r)}
                onClick={() => onChange({ ...value, roles: toggleIn(value.roles, r) })}
                label={t(`invitations:role_${r}` as const, r)}
              />
            ))}
          </PillRow>
        </Section>

        <Section title={t('memberFilterSectionLanguages')}>
          <PillRow>
            {LANGUAGES.map((l) => (
              <Pill
                key={l}
                active={value.languages.includes(l)}
                onClick={() => onChange({ ...value, languages: toggleIn(value.languages, l) })}
                label={t(`memberFilterLang_${l}` as const)}
              />
            ))}
            <Pill
              active={value.languages.includes('unset')}
              onClick={() => onChange({ ...value, languages: toggleIn(value.languages, 'unset') })}
              label={t('memberFilterLang_unset')}
            />
          </PillRow>
        </Section>

        <Section title={t('memberFilterSectionBirthdateVis')}>
          <PillRow>
            {BIRTHDATE_VIS.map((v) => (
              <Pill
                key={v}
                active={value.birthdateVis.includes(v)}
                onClick={() => onChange({ ...value, birthdateVis: toggleIn(value.birthdateVis, v) })}
                label={t(`memberFilterBdayVis_${v}` as const)}
              />
            ))}
          </PillRow>
        </Section>

        <Section title={t('memberFilterSectionConsent')}>
          <PillRow>
            {CONSENT_KEYS.map((c) => (
              <Pill
                key={c}
                active={value.consent.includes(c)}
                onClick={() => onChange({ ...value, consent: toggleIn(value.consent, c) })}
                label={t(`memberFilterConsent_${c}` as const)}
              />
            ))}
          </PillRow>
        </Section>

        <Section title={t('memberFilterSectionStatus')}>
          {BOOL_FIELDS.map((f) => (
            <TriRow key={f} label={boolLabels[f]} value={value.bools[f] ?? 'any'} onChange={(v) => setBool(f, v)} t={t} />
          ))}
        </Section>

        <Section title={t('memberFilterSectionDataPresence')}>
          {PRESENCE_FIELDS.map((f) => (
            <TriRow
              key={f}
              label={presenceLabels[f]}
              value={value.presence[f] ?? 'any'}
              onChange={(v) => setPresence(f, v)}
              t={t}
            />
          ))}
        </Section>
      </PopoverContent>
    </Popover>
  )
}

function omitKey<K extends string, V>(obj: Partial<Record<K, V>>, key: K): Partial<Record<K, V>> {
  const next = { ...obj }
  delete next[key]
  return next
}

function positionKey(p: MemberPosition): string {
  const map: Record<MemberPosition, string> = {
    setter: 'positionSetter',
    outside: 'positionOutside',
    middle: 'positionMiddle',
    opposite: 'positionOpposite',
    libero: 'positionLibero',
    point_guard: 'positionPointGuard',
    shooting_guard: 'positionShootingGuard',
    small_forward: 'positionSmallForward',
    power_forward: 'positionPowerForward',
    center: 'positionCenter',
    guest: 'positionGuest',
    staff_only: 'positionStaffOnly',
    other: 'positionOther',
  }
  return map[p]
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 border-t border-border pt-2 first:border-t-0 first:pt-0">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  )
}

function PillRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>
}

function Pill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-full border px-2.5 py-1 text-xs ' +
        (active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-foreground hover:bg-muted')
      }
    >
      {label}
    </button>
  )
}

function TriRow({
  label,
  value,
  onChange,
  t,
}: {
  label: string
  value: Tri
  onChange: (next: Tri) => void
  t: (key: string) => string
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="flex-1 truncate text-xs text-foreground" title={label}>
        {label}
      </span>
      <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-border text-[11px]">
        {(['any', 'yes', 'no'] as Tri[]).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={
              'px-2 py-0.5 ' +
              (value === opt
                ? opt === 'yes'
                  ? 'bg-primary text-primary-foreground'
                  : opt === 'no'
                    ? 'bg-destructive text-destructive-foreground'
                    : 'bg-muted text-foreground'
                : 'bg-card text-muted-foreground hover:bg-muted')
            }
          >
            {opt === 'any' ? t('memberFilterAny') : opt === 'yes' ? t('memberFilterYes') : t('memberFilterNo')}
          </button>
        ))}
      </div>
    </div>
  )
}
