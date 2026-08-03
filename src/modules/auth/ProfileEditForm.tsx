import { useState, useRef } from 'react'
import ChangePasswordModal from './ChangePasswordModal'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { FormInput, FormField } from '@/components/FormField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DatePicker from '@/components/ui/DatePicker'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '../../hooks/useAuth'
import { getFileUrl } from '../../utils/fileUrl'
import { coercePositions, getPositionI18nKey, getSelectablePositions } from '../../utils/memberPositions'
import { backendLangToI18n } from '../../utils/languageMap'
import { asObj, relId, memberName } from '../../utils/relations'
import { getCurrentSeason } from '../../utils/dateHelpers'
import { normalizePhone, normalizeAhv } from '../../utils/contact'
import { normalizeIban, isValidIban } from '../../utils/iban'
import { type BackendLanguage } from '../../i18n/languageConfig'
import LanguageSelect from '@/components/LanguageSelect'
import SearchableSelect from '@/components/ui/SearchableSelect'
import CountryMultiSelect from '@/components/CountryMultiSelect'
import {
  NO_FEDERATION, codeFromCountryName, countryNameDe,
  parseCountryCodes, serializeCountryCodes,
} from '../../utils/countries'
import { federationOptions } from '../../utils/federations'
import {
  TRAINER_LICENCE_CODES, TRAINER_LICENCE_I18N_KEYS,
  parseTrainerLicences, serializeTrainerLicences, type TrainerLicence,
} from '../../utils/trainerLicences'
import { CheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { logActivity } from '../../utils/logActivity'
import type { MemberPosition } from '../../types'
import { client, fetchAllItems, kscwApi, updateRecord, uploadFile } from '../../lib/api'


interface ProfileEditFormProps {
  /** Called after a successful save. */
  onSaved: () => void
  /** Called when the user cancels / skips without saving. Omit for a hard gate: the cancel/skip button is not rendered and saving is the only way out. */
  onCancel?: () => void
  /** Onboarding/first-run mode: hides the privacy/password/read-only sections, keeps the ClubDesk contact block expanded, and swaps the footer buttons. */
  onboarding?: boolean
  /**
   * Annual pre-licence data check (migration 270). Deliberately NOT a variant of
   * `onboarding`: that mode hides the read-only ClubDesk block, and the fee
   * category and licence living in there are precisely what this campaign asks
   * people to look at. So verify mode is the FULL form plus a banner, and
   * saving additionally stamps `profile_verified_at`.
   */
  verify?: boolean
  /** Rendered between the last form section and the Cancel/Save row — e.g. the identity-document card on /profile/edit. Not shown in onboarding call-sites (they simply don't pass it). */
  beforeActions?: React.ReactNode
}

/** The member fields the shirt-number conflict check reads off a `member_teams` row. */
type ConflictMember = { number?: number; first_name?: string; last_name?: string }
/** `member_teams` row as returned here: `member` may be an expanded object or a raw id. */
type TeammateRow = { member: ConflictMember | string | number | null }

/**
 * The profile-edit form body. Rendered inside `ProfileEditModal` (a `Modal`
 * wrapper still used for the onboarding call-sites) and standalone on the
 * `/profile/edit` subpage. All modal-specific chrome (the `Modal` wrapper, the
 * open/close-driven re-seed) lives with the caller — this component just seeds
 * from `user` on mount / when the member record changes identity.
 */
export default function ProfileEditForm({ onSaved, onCancel, onboarding, verify, beforeActions }: ProfileEditFormProps) {
  const { user, primarySport, memberTeamNames, refreshUser } = useAuth()
  const { t, i18n } = useTranslation('auth')
  const { t: tc } = useTranslation('common')
  const { t: tt } = useTranslation('teams')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [number, setNumber] = useState<number>(0)
  const [birthdate, setBirthdate] = useState('')
  const [hidePhone, setHidePhone] = useState(false)
  const [hideEmail, setHideEmail] = useState(false)
  const [birthdateVisibility, setBirthdateVisibility] = useState<'full' | 'year_only' | 'hidden'>('full')
  const [language, setLanguage] = useState<BackendLanguage>('german')
  const [websiteVisible, setWebsiteVisible] = useState(true)
  const [websiteNamePrivate, setWebsiteNamePrivate] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [selectedPositions, setSelectedPositions] = useState<MemberPosition[]>([])
  const [positionDropdownOpen, setPositionDropdownOpen] = useState(false)
  // Coaching education (migration 274). Multi-select: J+S is a separate track
  // from the C/B/A ladder, so holding both is normal.
  const [trainerLicences, setTrainerLicences] = useState<TrainerLicence[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [changePwOpen, setChangePwOpen] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  // ClubDesk fields
  const [anrede, setAnrede] = useState('')
  const [adresse, setAdresse] = useState('')
  const [plz, setPlz] = useState('')
  const [ort, setOrt] = useState('')
  // Nationality is stored as ordered ISO 3166-1 alpha-2 codes (migration 223);
  // the first one is primary and is what ClubDesk receives. `members.nationalitaet`
  // is a DB-derived German mirror and is never written from here.
  const [nationalitaetCodes, setNationalitaetCodes] = useState<string[]>([])
  const [federationOfOrigin, setFederationOfOrigin] = useState('')
  const [sex, setSex] = useState('')
  const [ahvNummer, setAhvNummer] = useState('')
  const [iban, setIban] = useState('')
  const [clubdeskOpen, setClubdeskOpen] = useState(false)

  // Seed every field from `user` on first render and whenever the member record
  // changes identity (e.g. `refreshUser()` after save, or an onboarding modal
  // that stays mounted while the user is fetched). Done as a render-phase state
  // adjustment (React's sanctioned replacement for a synchronous setState inside
  // an effect, react-hooks/set-state-in-effect): the sentinel starts at `null`
  // so a form that mounts with `user` already present seeds itself immediately —
  // both the standalone page and a modal that mounts already open.
  const [seededUser, setSeededUser] = useState<typeof user>(null)
  if (seededUser !== user) {
    setSeededUser(user)
    if (user) {
      setFirstName(user.first_name ?? '')
      setLastName(user.last_name ?? '')
      setNickname(user.nickname ?? '')
      setEmail(user.email ?? '')
      setPhone(user.phone ?? '')
      setNumber(user.number ?? 0)
      setBirthdate(user.birthdate ? user.birthdate.slice(0, 10) : '')
      setHidePhone(user.hide_phone ?? false)
      setHideEmail(user.hide_email ?? false)
      setWebsiteVisible(user.website_visible ?? true)
      setWebsiteNamePrivate(user.website_name_private ?? false)
      setBirthdateVisibility((user.birthdate_visibility as 'full' | 'year_only' | 'hidden') || 'hidden')
      setLanguage((user.language as BackendLanguage) || 'german')
      setSelectedPositions(coercePositions(user.position))
      setPositionDropdownOpen(false)
      setTrainerLicences(parseTrainerLicences(user.trainer_licences))
      setPhotoFile(null)
      setPhotoPreview(null)
      setError('')
      setResetSent(false)
      setResetLoading(false)
      // ClubDesk fields
      setAnrede(user.anrede ?? '')
      setAdresse(user.adresse ?? '')
      setPlz(user.plz ?? '')
      setOrt(user.ort ?? '')
      setNationalitaetCodes(storedNationalityCodes())
      setFederationOfOrigin(user.federation_of_origin ?? '')
      setSex(user.sex ?? '')
      setAhvNummer(user.ahv_nummer ?? '')
      setIban(user.iban ?? '')
      setClubdeskOpen(false)
    }
  }

  /**
   * Federation-of-origin options: the explicit "none" sentinel first, then the
   * country list. NULL (never answered) and 'NONE' (answered: never licensed
   * elsewhere) are different states — only the latter lets the club skip
   * chasing a transfer certificate, so it has to be selectable.
   */
  // Labelled with the federation for the member's sport ("FIPAV (Italy)") rather
  // than the bare country — the question asks which BODY licensed them, and the
  // answer differs by sport. `both` (or no sport) has no single right federation,
  // so those members see plain country names.
  const fedSport = primarySport === 'volleyball' || primarySport === 'basketball' ? primarySport : undefined
  const fedOptions = [
    { value: NO_FEDERATION, label: t('federationOfOriginNone') },
    ...federationOptions(fedSport),
  ]

  /**
   * The member's STORED nationality as codes, falling back to resolving the
   * legacy free-text name for rows that predate `nationalitaet_codes` and
   * haven't been touched since. Seeds the picker and anchors the ClubDesk diff,
   * so an untouched field can never diff against itself.
   */
  function storedNationalityCodes(): string[] {
    const codes = parseCountryCodes(user?.nationalitaet_codes)
    return codes.length ? codes : [codeFromCountryName(user?.nationalitaet)].filter(Boolean)
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError(t('fileTooLarge'))
      return
    }
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!validTypes.includes(file.type)) {
      setError(t('invalidImageType'))
      return
    }
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  function handleLanguageChange(val: BackendLanguage) {
    setLanguage(val)
    // Immediately preview the chosen language in the UI
    i18n.changeLanguage(backendLangToI18n(val))
  }

  async function handlePasswordReset() {
    if (!user?.email) return
    setResetLoading(true)
    try {
      await kscwApi('/password-request', { method: 'POST', body: { email: user.email } })
      setResetSent(true)
    } catch {
      setError(t('errorSaving'))
    } finally {
      setResetLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setError('')
    setLoading(true)

    try {
      // First name, last name and email are mandatory — never let a member
      // blank them out (an empty email wipes their only contact channel and
      // breaks notifications / ClubDesk sync). `required` on the inputs blocks
      // empty submits; this also rejects whitespace-only and bad email formats.
      const fn = firstName.trim()
      const ln = lastName.trim()
      const em = email.trim()
      if (!fn || !ln || !em) {
        setError(t('requiredProfileFields'))
        setLoading(false)
        return
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
        setError(t('invalidEmail'))
        setLoading(false)
        return
      }

      // Canonicalize phone + AHV (src/utils/contact.ts — same rules as the
      // registration backend), so members.phone/ahv_nummer only ever hold the
      // canonical formats both databases converge on.
      const phoneNorm = normalizePhone(phone)
      if (!phoneNorm.ok) {
        setError(t('invalidPhoneFormat'))
        setLoading(false)
        return
      }
      const phoneCanonical = phoneNorm.value ?? ''
      const ahvNorm = normalizeAhv(ahvNummer)
      if (!ahvNorm.ok) {
        setError(t('invalidAhvFormat'))
        setLoading(false)
        return
      }
      const ahvCanonical = ahvNorm.value ?? ''

      // IBAN is optional; when provided it must pass the ISO 13616 checksum.
      // Stored normalised (uppercase, no spaces), same canonical form the
      // Finance payout card and reimbursement upload use.
      const ibanTrimmed = iban.trim()
      let ibanCanonical = ''
      if (ibanTrimmed) {
        if (!isValidIban(ibanTrimmed)) {
          setError(t('invalidIban'))
          setLoading(false)
          return
        }
        ibanCanonical = normalizeIban(ibanTrimmed)
      }

      // Core contact set — required in every mode (2026-07-28): the club
      // register needs these, and clearing one later would only re-trigger the
      // Layout onboarding gate on the next load. Checked after the phone
      // normalization so a malformed phone gets its specific error first.
      if (!phoneCanonical || !birthdate || !adresse.trim() || !plz.trim()
        || !ort.trim() || nationalitaetCodes.length === 0) {
        setClubdeskOpen(true) // the missing field may sit in the collapsed section
        setError(t('coreContactRequired'))
        setLoading(false)
        return
      }

      // Check for duplicate number in the same team(s)
      if (number > 0 && number !== user.number) {
        const myTeams = await fetchAllItems('member_teams', {
          // Current season only — otherwise an archived prior-season membership
          // would raise a false "number taken" against a last-season teammate.
          filter: { member: { _eq: user.id }, season: { _eq: getCurrentSeason() } },
        })
        const teamIds = myTeams.map((mt) => relId(mt.team))
        if (teamIds.length > 0) {
          const teammates = await fetchAllItems<TeammateRow>('member_teams', {
            filter: { _and: [{ team: { _in: teamIds } }, { member: { _neq: user.id } }] },
          })
          const conflict = teammates.find(
            (mt) => asObj<ConflictMember>(mt.member)?.number === number
          )
          if (conflict) {
            const conflictMember = asObj<ConflictMember>(conflict.member)
            const conflictName = memberName(conflictMember) || '?'
            setError(t('numberTaken', { name: conflictName }))
            setLoading(false)
            return
          }
        }
      }

      const payload: Record<string, unknown> = {
        first_name: fn,
        last_name: ln,
        nickname: nickname.trim(),
        email: em,
        phone: phoneCanonical,
        number,
        hide_phone: hidePhone,
        hide_email: hideEmail,
        birthdate_visibility: birthdateVisibility,
        website_visible: websiteVisible,
        website_name_private: websiteNamePrivate,
        language,
        position: selectedPositions.length > 0 ? selectedPositions : ['other'],
        // Coaching education (migration 274). wiedisync-owned, and pushed to
        // ClubDesk's "Trainer Lizenz" free-text column (migration 275) — so it
        // also rides the ClubDesk diff below.
        trainer_licences: serializeTrainerLicences(trainerLicences),
      }
      if (birthdate) {
        payload.birthdate = birthdate
      }

      // Validate PLZ if provided
      if (plz && (!/^\d{4}$/.test(plz) || parseInt(plz) < 1000)) {
        setError(t('invalidPlz'))
        setLoading(false)
        return
      }

      // ClubDesk fields
      payload.anrede = anrede
      payload.adresse = adresse.trim()
      payload.plz = plz.trim()
      payload.ort = ort.trim()
      // Codes only — a DB trigger derives `members.nationalitaet` (the German
      // string ClubDesk consumes) from the first code, so writing both here
      // would just be two sources of truth for one fact.
      payload.nationalitaet_codes = serializeCountryCodes(nationalitaetCodes)
      payload.federation_of_origin = federationOfOrigin || null
      payload.sex = sex
      payload.ahv_nummer = ahvCanonical
      payload.iban = ibanCanonical
      // Typing your own IBAN in the profile counts as confirming it — clears the
      // Finance "please confirm your IBAN" prompt (the iban_confirmed flow from
      // migration 136, which exists for ClubDesk-backfilled IBANs).
      if (ibanCanonical) payload.iban_confirmed = true

      // Annual pre-licence data check (migration 270). Stamped only from the
      // gate itself: a routine profile edit is not the same statement as "I
      // have read every field and they are all correct", and treating it as one
      // would let the campaign report people as checked who never were.
      if (verify) payload.profile_verified_at = new Date().toISOString()

      // Upload the photo to /files first (multipart), then set the FK in the
      // plain-JSON payload. Passing FormData straight to updateRecord() is a
      // silent no-op: the Directus SDK's updateItem JSON.stringifies the body,
      // and JSON.stringify(FormData) === '{}' → empty PATCH that "succeeds"
      // but saves nothing. File fields must go through POST /files.
      if (photoFile) {
        const { id: fileId } = await uploadFile(photoFile)
        payload.photo = fileId
      }
      await updateRecord('members', user.id, payload)
      logActivity('update', 'members', user.id, { first_name: fn, last_name: ln, nickname: nickname.trim(), phone, language, position: selectedPositions })
      // Detect ClubDesk field changes and notify admin
      const clubdeskFields = {
        first_name: { old: user.first_name, new: fn },
        last_name: { old: user.last_name, new: ln },
        email: { old: user.email, new: em },
        phone: { old: user.phone, new: phoneCanonical },
        birthdate: { old: user.birthdate?.slice(0, 10) || '', new: birthdate },
        anrede: { old: user.anrede || '', new: anrede },
        adresse: { old: user.adresse || '', new: adresse },
        plz: { old: user.plz || '', new: plz },
        ort: { old: user.ort || '', new: ort },
        // The coded fields diff — and travel — as CODES, never as labels. The
        // admin email renders them server-side in the READER's language (an
        // English-speaking admin used to read "Schweiz"), and a label diff also
        // compared apples to pears: the old side listed every nationality while
        // the server rebuilt the new side from the German primary-only mirror,
        // so an unchanged "DE,CH" reported as "Deutschland, Schweiz → Deutschland".
        nationalitaet: {
          old: serializeCountryCodes(storedNationalityCodes()) ?? '',
          new: serializeCountryCodes(nationalitaetCodes) ?? '',
        },
        federation_of_origin: {
          old: user.federation_of_origin ?? '',
          new: federationOfOrigin,
        },
        // Coaching education — diffed as CODES for the same reason as the two
        // fields above: the endpoint renders them twice server-side (ClubDesk's
        // "J+S, B" for the register, the reader's language for the admin email).
        // ⚠ Must stay in step with the EDITABLE set in clubdesk-update.js — a
        // field diffed here but missing there makes a change to ONLY this field
        // return 400 "No editable fields to update".
        trainer_licences: {
          old: serializeTrainerLicences(parseTrainerLicences(user.trainer_licences)) ?? '',
          new: serializeTrainerLicences(trainerLicences) ?? '',
        },
        sex: { old: user.sex || '', new: sex },
        ahv_nummer: { old: user.ahv_nummer || '', new: ahvCanonical },
        iban: { old: user.iban || '', new: ibanCanonical },
      }
      // Normalize before diffing — `undefined`/`null`/`''`/whitespace must all
      // compare equal, otherwise an empty optional field (e.g. phone) emits a
      // bogus "— → —" change row in the admin ClubDesk email.
      const norm = (v: unknown) => String(v ?? '').trim()
      const changes = Object.entries(clubdeskFields)
        .filter(([, v]) => norm(v.old) !== norm(v.new))
        .map(([field, v]) => ({ field, old_value: norm(v.old), new_value: norm(v.new) }))

      if (changes.length > 0) {
        // Fire-and-forget — don't block modal close for the email
        kscwApi('/clubdesk-update', {
          method: 'POST',
          body: {
            member_id: user.id,
            changes,
            current_data: {
              anrede, first_name: fn, last_name: ln,
              email: em, phone, adresse, plz, ort,
              birthdate, sex, ahv_nummer: ahvNummer,
              // ClubDesk's picklists take the German name, so send the derived
              // string rather than the codes we store.
              nationalitaet: countryNameDe(nationalitaetCodes[0]),
              federation_of_origin: federationOfOrigin,
              beitragskategorie: user.beitragskategorie || '',
            },
          },
        })
          .then(() => toast.success(t('clubdeskUpdateSent')))
          .catch(() => console.warn('ClubDesk update email failed'))
      }
      // Persist language to localStorage
      localStorage.setItem('wiedisync-lang', backendLangToI18n(language))
      await client.refresh()
      // Re-fetch the member so the new photo / edited fields show without a
      // full page reload.
      await refreshUser()
      onSaved()
    } catch {
      setError(t('errorSaving'))
    } finally {
      setLoading(false)
    }
  }

  if (!user) return null

  const initials = `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase()
  const currentPhoto = photoPreview
    ?? (user.photo ? getFileUrl('members', user.id, user.photo) : null)
  // In onboarding mode, data is pre-populated if the member was imported from Clubdesk

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Onboarding subtitle */}
      {onboarding && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('onboardingSubtitle')}
        </p>
      )}

      {/* Pre-licence data check (migration 270). Says what to look at AND what
          to do about the fields the member cannot change themselves — without
          that second half the greyed-out fee category just reads as a bug. */}
      {verify && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm leading-relaxed text-brand-900 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-100">
          <p className="font-medium">{t('verifyTitle')}</p>
          <p className="mt-1">{t('verifyBody')}</p>
          <p className="mt-1">{t('verifyReadOnly')}</p>
          <p className="mt-1 text-xs">{t('verifyMinors')}</p>
        </div>
      )}

      {/* Language selector */}
      <FormField label={`${t('language')}${onboarding ? ' *' : ''}`}>
        <LanguageSelect value={language} onChange={handleLanguageChange} />
      </FormField>

      {/* Photo */}
      <div className="flex items-center gap-4">
        {currentPhoto ? (
          <img
            src={currentPhoto}
            alt=""
            className="h-16 w-16 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-200 text-lg font-bold text-gray-500 dark:bg-gray-700 dark:text-gray-400">
            {initials}
          </div>
        )}
        <div className="space-y-2">
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              {t('changePhoto')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoChange}
              className="hidden"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={websiteVisible}
              onCheckedChange={setWebsiteVisible}
              id="website-visible"
            />
            <label htmlFor="website-visible" className="cursor-pointer text-sm text-gray-700 dark:text-gray-300">
              {t('websiteVisible')}
            </label>
            <button
              type="button"
              onClick={() => setInfoOpen(true)}
              aria-label={t('websiteVisible')}
              title={t('websiteVisible')}
              className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-500 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-400 dark:hover:bg-gray-500"
            >
              i
            </button>
          </div>
        </div>
      </div>

      {/* Website visibility info modal */}
      <Modal open={infoOpen} onClose={() => setInfoOpen(false)} title={t('websiteVisible')} size="sm">
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('websiteVisibleInfo')}</p>
        <div className="mt-4 flex justify-end">
          <Button type="button" size="sm" onClick={() => setInfoOpen(false)}>OK</Button>
        </div>
      </Modal>

      <div className="grid grid-cols-1 gap-4">
        <FormInput
          label={`${t('firstName')}${onboarding ? ' *' : ''}`}
          type="text"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          required
        />
        <FormInput
          label={`${t('lastName')}${onboarding ? ' *' : ''}`}
          type="text"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          required
        />
      </div>

      <FormInput
        label={t('nickname')}
        type="text"
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        helperText={t('nicknameHint')}
      />

      <FormInput
        label={t('email')}
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />

      <FormInput
        label={`${t('phone')}${onboarding ? ' *' : ''}`}
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        required
      />

      <div className="grid grid-cols-1 gap-4">
        <FormInput
          label={t('number')}
          type="number"
          min={0}
          max={99}
          value={number || ''}
          onChange={(e) => setNumber(parseInt(e.target.value) || 0)}
          placeholder="#"
        />
        <DatePicker
          label={`${t('birthdate')}${onboarding ? ' *' : ''}`}
          value={birthdate}
          onChange={setBirthdate}
          required
        />
      </div>

      {/* Position (checkbox dropdown) */}
      <FormField label={t('position')}>
        <div
          className="relative"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && positionDropdownOpen) {
              e.stopPropagation()
              setPositionDropdownOpen(false)
            }
          }}
        >
          <button
            type="button"
            onClick={() => setPositionDropdownOpen(!positionDropdownOpen)}
            aria-haspopup="listbox"
            aria-expanded={positionDropdownOpen}
            aria-label={t('position')}
            className="flex min-h-[44px] w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-colors hover:border-brand-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-brand-500"
          >
            <span className={selectedPositions.length === 0 ? 'text-gray-400' : ''}>
              {selectedPositions.length > 0
                ? selectedPositions.map((p) => (getPositionI18nKey(p) ? tt(getPositionI18nKey(p)!) : p)).join(', ')
                : '—'}
            </span>
            <svg className={`h-4 w-4 text-gray-400 transition-transform ${positionDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {positionDropdownOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setPositionDropdownOpen(false)} />
              <div
                role="listbox"
                aria-multiselectable="true"
                aria-label={t('position')}
                className="absolute left-0 z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800"
              >
                {getSelectablePositions(
                  primarySport === 'both' ? undefined : primarySport,
                  selectedPositions,
                ).map((p) => {
                  const active = selectedPositions.includes(p)
                  return (
                    <button
                      key={p}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        setSelectedPositions((prev) =>
                          active ? prev.filter((pos) => pos !== p) : [...prev, p],
                        )
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                      <span className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background dark:bg-input/30'}`}>
                        {active && <CheckIcon className="size-3.5" />}
                      </span>
                      {getPositionI18nKey(p) ? tt(getPositionI18nKey(p)!) : p}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </FormField>

      {/* ClubDesk personal data — in onboarding the block is always expanded
          (not collapsible): address + nationality are part of the required
          core contact set, so hiding them would make the gate unpassable. */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-600">
        <button
          type="button"
          onClick={() => !onboarding && setClubdeskOpen(!clubdeskOpen)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100"
          style={{ minHeight: 44 }}
        >
          <span>{t('personalDataClubdesk')}</span>
          {!onboarding && (
            <svg className={`h-4 w-4 text-gray-400 transition-transform ${clubdeskOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </button>
        {(clubdeskOpen || onboarding) && (
          <div className="space-y-4 border-t border-gray-200 px-4 py-4 dark:border-gray-600">
            {/* Anrede + Geschlecht */}
            <div className="grid grid-cols-2 gap-4">
              <FormField label={t('anrede')}>
                <Select value={anrede} onValueChange={setAnrede}>
                  <SelectTrigger className="min-h-[44px]">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Herr">{t('mr')}</SelectItem>
                    <SelectItem value="Frau">{t('mrs')}</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label={t('sex')}>
                <Select value={sex} onValueChange={setSex}>
                  <SelectTrigger className="min-h-[44px]">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="m">{t('male')}</SelectItem>
                    <SelectItem value="f">{t('female')}</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            {/* Adresse */}
            <FormInput
              label={`${t('adresse')}${onboarding ? ' *' : ''}`}
              value={adresse}
              onChange={(e) => setAdresse(e.target.value)}
              required
            />

            {/* PLZ + Ort */}
            <div className="grid grid-cols-[120px_1fr] gap-4">
              <FormInput
                label={`${t('plz')}${onboarding ? ' *' : ''}`}
                value={plz}
                onChange={(e) => setPlz(e.target.value)}
                inputMode="numeric"
                maxLength={4}
                required
              />
              <FormInput
                label={`${t('ort')}${onboarding ? ' *' : ''}`}
                value={ort}
                onChange={(e) => setOrt(e.target.value)}
                required
              />
            </div>

            {/* Nationalität — multi-select; the first pick is the primary one
                and is what ClubDesk (single-valued) receives. */}
            <CountryMultiSelect
              label={`${t('nationalitaet')}${onboarding ? ' *' : ''}`}
              selected={nationalitaetCodes}
              onChange={setNationalitaetCodes}
              helperText={t('nationalitaetHint')}
            />

            {/* Herkunftsverband */}
            <FormField label={t('federationOfOrigin')} helperText={t('federationOfOriginHint')}>
              <SearchableSelect
                options={fedOptions}
                value={federationOfOrigin}
                onChange={setFederationOfOrigin}
                searchPlaceholder={tc('searchCountry')}
              />
            </FormField>

            {/* Trainerausbildung (migration 274) — lives in this block because
                it is pushed to ClubDesk's "Trainer Lizenz" column (migration
                275), like everything else here. Toggle chips rather than a
                dropdown: the set is four items and multi-select, so every option
                fits on screen and the current answer reads without opening
                anything. Optional, so it does not affect the onboarding gate. */}
            <FormField label={t('trainerLicences')} helperText={t('trainerLicencesHint')}>
              <div className="flex flex-wrap gap-2">
                {TRAINER_LICENCE_CODES.map((code) => {
                  const active = trainerLicences.includes(code)
                  return (
                    <button
                      key={code}
                      type="button"
                      role="checkbox"
                      aria-checked={active}
                      onClick={() => {
                        setTrainerLicences((prev) =>
                          prev.includes(code)
                            ? prev.filter((c) => c !== code)
                            : parseTrainerLicences([...prev, code].join(',')),
                        )
                      }}
                      className={`flex min-h-[44px] items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                        active
                          ? 'border-primary bg-primary/10 font-medium text-foreground'
                          : 'border-gray-300 bg-white text-gray-700 hover:border-brand-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-brand-500'
                      }`}
                    >
                      <span className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background dark:bg-input/30'}`}>
                        {active && <CheckIcon className="size-3.5" />}
                      </span>
                      {t(TRAINER_LICENCE_I18N_KEYS[code])}
                    </button>
                  )
                })}
              </div>
            </FormField>

            {/* AHV Nummer */}
            <FormInput
              label={t('ahvNummer')}
              value={ahvNummer}
              onChange={(e) => setAhvNummer(e.target.value)}
              placeholder="756.XXXX.XXXX.XX"
            />

            {/* IBAN — member's own bank account for reimbursements. Also
                editable on the Finance payout card; kept here too on request. */}
            <FormInput
              label={t('iban')}
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              placeholder="CH00 0000 0000 0000 0000 0"
              helperText={t('ibanHint')}
            />

            {/* Read-only admin fields — noise for a first-run user, so
                onboarding hides them */}
            {!onboarding && (
              <div className="mt-2 space-y-2 rounded-md bg-gray-50 p-3 dark:bg-gray-800">
                <p className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  {t('managedByAdmin')}
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{t('beitragskategorie')}</span>
                    <p className="text-gray-700 dark:text-gray-300">{user.beitragskategorie || '—'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{tc('team')}</span>
                    <p className="text-gray-700 dark:text-gray-300">{memberTeamNames?.join(', ') || '—'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{t('status')}</span>
                    <p className="text-gray-700 dark:text-gray-300">{user.kscw_membership_active ? t('active') : t('passive')}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Privacy — hidden in onboarding */}
      {!onboarding && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-600 dark:bg-gray-800">
          <p className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('privacySection')}
          </p>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <Switch checked={hidePhone} onCheckedChange={setHidePhone} />
              <div>
                <span className="text-sm text-gray-700 dark:text-gray-300">{t('hidePhone')}</span>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t('hidePhoneHint')}</p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <Switch checked={hideEmail} onCheckedChange={setHideEmail} />
              <div>
                <span className="text-sm text-gray-700 dark:text-gray-300">{t('hideEmail')}</span>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t('hideEmailHint')}</p>
              </div>
            </label>
            <FormField label={t('birthdateVisibility')}>
              <Select value={birthdateVisibility} onValueChange={(v) => setBirthdateVisibility(v as 'full' | 'year_only' | 'hidden')}>
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">{t('birthdateVisibilityFull')}</SelectItem>
                  <SelectItem value="year_only">{t('birthdateVisibilityYearOnly')}</SelectItem>
                  <SelectItem value="hidden">{t('birthdateVisibilityHidden')}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <label className="flex items-center gap-3 cursor-pointer">
              <Switch checked={websiteNamePrivate} onCheckedChange={setWebsiteNamePrivate} />
              <div>
                <span className="text-sm text-gray-700 dark:text-gray-300">{t('websiteNameOnly')}</span>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t('websiteNameOnlyHint')}</p>
              </div>
            </label>
          </div>
        </div>
      )}

      {/* Change password — hidden in onboarding.
          Prefer the in-app change (it verifies the current password, so it can re-wrap the
          member's encryption key and their identity document survives). The email reset
          link is the fallback for someone who has actually forgotten it — and it DESTROYS
          the key, because nobody can re-wrap with a secret nobody has. */}
      {!onboarding && (
        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-600 dark:bg-gray-800">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('changePassword')}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setChangePwOpen(true)}
            >
              {t('changePassword')}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t('forgotPassword')}
            </span>
            {resetSent ? (
              <span className="text-xs text-green-600 dark:text-green-400">
                {t('resetLinkSent')}
              </span>
            ) : (
              <button
                type="button"
                onClick={handlePasswordReset}
                disabled={resetLoading}
                className="text-xs text-gray-500 underline underline-offset-2 dark:text-gray-400"
              >
                {resetLoading ? tc('saving') : t('sendResetLink')}
              </button>
            )}
          </div>
        </div>
      )}
      {changePwOpen && <ChangePasswordModal onClose={() => setChangePwOpen(false)} />}

      {/* Read-only fields — hidden in onboarding */}
      {!onboarding && user.license_nr && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-800">
          <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('managedByCoach')}
          </p>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            <span>{t('licenseNr')}: {user.license_nr}</span>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {beforeActions && <div className="pt-2">{beforeActions}</div>}

      <div className="flex justify-end gap-3 pt-2">
        {/* No onCancel = hard gate (Layout's forced onboarding): saving is the
            only way out, so no skip/cancel button is offered. */}
        {onCancel && (onboarding ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
          >
            {t('skipForNow')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
          >
            {tc('cancel')}
          </Button>
        ))}
        <Button
          type="submit"
          loading={loading}
        >
          {loading ? tc('saving') : onboarding ? t('completeProfile') : verify ? t('verifyConfirm') : tc('save')}
        </Button>
      </div>
    </form>
  )
}
