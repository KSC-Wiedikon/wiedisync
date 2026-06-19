import { useState, useEffect, useRef } from 'react'
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
import { isValidIban, normalizeIban } from '../../utils/iban'
import { LANGUAGES, type BackendLanguage } from '../../i18n/languageConfig'
import deFlag from '../../assets/flags/de.svg'
import gbFlag from '../../assets/flags/gb.svg'

import frFlag from '../../assets/flags/fr.svg'
import itFlag from '../../assets/flags/it.svg'
import chFlag from '../../assets/flags/ch.svg'

const flagMap: Record<string, string> = { de: deFlag, gb: gbFlag, fr: frFlag, it: itFlag, ch: chFlag }
import { CheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { logActivity } from '../../utils/logActivity'
import type { MemberPosition } from '../../types'
import { client, fetchAllItems, kscwApi, updateRecord, uploadFile } from '../../lib/api'


interface ProfileEditModalProps {
  open: boolean
  onClose: () => void
  onboarding?: boolean
}

export default function ProfileEditModal({ open, onClose, onboarding }: ProfileEditModalProps) {
  const { user, primarySport, memberTeamNames, refreshUser } = useAuth()
  const { t, i18n } = useTranslation('auth')
  const { t: tc } = useTranslation('common')
  const { t: tt } = useTranslation('teams')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [number, setNumber] = useState<number>(0)
  const [birthdate, setBirthdate] = useState('')
  const [hidePhone, setHidePhone] = useState(false)
  const [hideEmail, setHideEmail] = useState(false)
  const [birthdateVisibility, setBirthdateVisibility] = useState<'full' | 'year_only' | 'hidden'>('full')
  const [language, setLanguage] = useState<BackendLanguage>('german')
  const [websiteVisible, setWebsiteVisible] = useState(true)
  const [infoOpen, setInfoOpen] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [selectedPositions, setSelectedPositions] = useState<MemberPosition[]>([])
  const [positionDropdownOpen, setPositionDropdownOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  // ClubDesk fields
  const [anrede, setAnrede] = useState('')
  const [adresse, setAdresse] = useState('')
  const [plz, setPlz] = useState('')
  const [ort, setOrt] = useState('')
  const [nationalitaet, setNationalitaet] = useState('')
  const [sex, setSex] = useState('')
  const [ahvNummer, setAhvNummer] = useState('')
  const [iban, setIban] = useState('')
  const [clubdeskOpen, setClubdeskOpen] = useState(false)

  useEffect(() => {
    if (user && open) {
      setFirstName(user.first_name ?? '')
      setLastName(user.last_name ?? '')
      setEmail(user.email ?? '')
      setPhone(user.phone ?? '')
      setNumber(user.number ?? 0)
      setBirthdate(user.birthdate ? user.birthdate.slice(0, 10) : '')
      setHidePhone(user.hide_phone ?? false)
      setHideEmail(user.hide_email ?? false)
      setWebsiteVisible(user.website_visible ?? true)
      setBirthdateVisibility((user.birthdate_visibility as 'full' | 'year_only' | 'hidden') || 'hidden')
      setLanguage((user.language as BackendLanguage) || 'german')
      setSelectedPositions(coercePositions(user.position))
      setPositionDropdownOpen(false)
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
      setNationalitaet(user.nationalitaet ?? '')
      setSex(user.sex ?? '')
      setAhvNummer(user.ahv_nummer ?? '')
      setIban(user.iban ?? '')
      setClubdeskOpen(false)
    }
  }, [user, open])

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

      // Check for duplicate number in the same team(s)
      if (number > 0 && number !== user.number) {
        const myTeams = await fetchAllItems('member_teams', {
          // Current season only — otherwise an archived prior-season membership
          // would raise a false "number taken" against a last-season teammate.
          filter: { member: { _eq: user.id }, season: { _eq: getCurrentSeason() } },
        })
        const teamIds = myTeams.map((mt) => relId(mt.team))
        if (teamIds.length > 0) {
          const teammates = await fetchAllItems('member_teams', {
            filter: { _and: [{ team: { _in: teamIds } }, { member: { _neq: user.id } }] },
          })
          const conflict = teammates.find(
            (mt) => asObj<{ number?: number; first_name?: string; last_name?: string }>(mt.member as any)?.number === number
          )
          if (conflict) {
            const conflictMember = asObj<{ number?: number; first_name?: string; last_name?: string }>(conflict.member as any)
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
        email: em,
        phone,
        number,
        hide_phone: hidePhone,
        hide_email: hideEmail,
        birthdate_visibility: birthdateVisibility,
        website_visible: websiteVisible,
        language,
        position: selectedPositions.length > 0 ? selectedPositions : ['other'],
      }
      if (birthdate) {
        payload.birthdate = birthdate
      }

      // Validate AHV format if provided
      if (ahvNummer && !/^756\.\d{4}\.\d{4}\.\d{2}$/.test(ahvNummer)) {
        setError(t('invalidAhvFormat'))
        setLoading(false)
        return
      }

      // Validate PLZ if provided
      if (plz && (!/^\d{4}$/.test(plz) || parseInt(plz) < 1000)) {
        setError(t('invalidPlz'))
        setLoading(false)
        return
      }

      // Validate IBAN if provided (ISO 13616 + mod-97 checksum)
      if (iban.trim() && !isValidIban(iban)) {
        setError(t('invalidIban'))
        setLoading(false)
        return
      }

      // ClubDesk fields
      payload.anrede = anrede
      payload.adresse = adresse
      payload.plz = plz
      payload.ort = ort
      payload.nationalitaet = nationalitaet
      payload.sex = sex
      payload.ahv_nummer = ahvNummer
      // Store the normalised (spaces-stripped, uppercased) IBAN, or null when cleared.
      payload.iban = iban.trim() ? normalizeIban(iban) : null

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
      logActivity('update', 'members', user.id, { first_name: fn, last_name: ln, phone, language, position: selectedPositions })
      // Detect ClubDesk field changes and notify admin
      const clubdeskFields = {
        first_name: { old: user.first_name, new: fn },
        last_name: { old: user.last_name, new: ln },
        email: { old: user.email, new: em },
        phone: { old: user.phone, new: phone },
        birthdate: { old: user.birthdate?.slice(0, 10) || '', new: birthdate },
        anrede: { old: user.anrede || '', new: anrede },
        adresse: { old: user.adresse || '', new: adresse },
        plz: { old: user.plz || '', new: plz },
        ort: { old: user.ort || '', new: ort },
        nationalitaet: { old: user.nationalitaet || '', new: nationalitaet },
        sex: { old: user.sex || '', new: sex },
        ahv_nummer: { old: user.ahv_nummer || '', new: ahvNummer },
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
              birthdate, nationalitaet, sex, ahv_nummer: ahvNummer,
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
      onClose()
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
    <Modal
      open={open}
      onClose={onClose}
      title={onboarding ? t('onboardingTitle') : t('editProfile')}
      size="lg"
      hideClose={false}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Onboarding subtitle */}
        {onboarding && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('onboardingSubtitle')}
          </p>
        )}

        {/* Language selector */}
        <FormField label={`${t('language')}${onboarding ? ' *' : ''}`}>
          <Select value={language} onValueChange={(v) => handleLanguageChange(v as BackendLanguage)}>
            <SelectTrigger className="min-h-[44px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang.backendValue} value={lang.backendValue}>
                  <span className="flex items-center gap-2">
                    <img src={flagMap[lang.flag]} alt="" className={`${lang.flag === 'ch' ? 'w-[15px] h-[15px]' : 'w-5 h-[15px]'} rounded-[2px]`} />
                    {lang.nativeName}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          label={t('email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <FormInput
          label={t('phone')}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
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
            label={t('birthdate')}
            value={birthdate}
            onChange={setBirthdate}
          />
        </div>

        {/* Position (checkbox dropdown) */}
        <FormField label={t('position')}>
          <div className="relative">
            <button
              type="button"
              onClick={() => setPositionDropdownOpen(!positionDropdownOpen)}
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
                <div className="absolute left-0 z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800">
                  {getSelectablePositions(
                    primarySport === 'both' ? undefined : primarySport,
                    selectedPositions,
                  ).map((p) => {
                    const active = selectedPositions.includes(p)
                    return (
                      <button
                        key={p}
                        type="button"
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

        {/* ClubDesk personal data — hidden in onboarding */}
        {!onboarding && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-600">
            <button
              type="button"
              onClick={() => setClubdeskOpen(!clubdeskOpen)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100"
              style={{ minHeight: 44 }}
            >
              <span>{t('personalDataClubdesk')}</span>
              <svg className={`h-4 w-4 text-gray-400 transition-transform ${clubdeskOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {clubdeskOpen && (
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
                  label={t('adresse')}
                  value={adresse}
                  onChange={(e) => setAdresse(e.target.value)}
                />

                {/* PLZ + Ort */}
                <div className="grid grid-cols-[120px_1fr] gap-4">
                  <FormInput
                    label={t('plz')}
                    value={plz}
                    onChange={(e) => setPlz(e.target.value)}
                    inputMode="numeric"
                    maxLength={4}
                  />
                  <FormInput
                    label={t('ort')}
                    value={ort}
                    onChange={(e) => setOrt(e.target.value)}
                  />
                </div>

                {/* Nationalität */}
                <FormInput
                  label={t('nationalitaet')}
                  value={nationalitaet}
                  onChange={(e) => setNationalitaet(e.target.value)}
                />

                {/* AHV Nummer */}
                <FormInput
                  label={t('ahvNummer')}
                  value={ahvNummer}
                  onChange={(e) => setAhvNummer(e.target.value)}
                  placeholder="756.XXXX.XXXX.XX"
                />

                {/* IBAN — for reimbursements. Sensitive: own-member + admin only. */}
                <FormInput
                  label={t('iban')}
                  value={iban}
                  onChange={(e) => setIban(e.target.value)}
                  placeholder="CH00 0000 0000 0000 0000 0"
                  helperText={t('ibanHint')}
                />

                {/* Read-only admin fields */}
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
              </div>
            )}
          </div>
        )}

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
            </div>
          </div>
        )}

        {/* Change Password — hidden in onboarding */}
        {!onboarding && (
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-600 dark:bg-gray-800">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('changePassword')}
            </span>
            {resetSent ? (
              <span className="text-sm text-green-600 dark:text-green-400">
                {t('resetLinkSent')}
              </span>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handlePasswordReset}
                loading={resetLoading}
              >
                {resetLoading ? tc('saving') : t('sendResetLink')}
              </Button>
            )}
          </div>
        )}

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

        <div className="flex justify-end gap-3 pt-2">
          {onboarding ? (
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
            >
              {t('skipForNow')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
            >
              {tc('cancel')}
            </Button>
          )}
          <Button
            type="submit"
            loading={loading}
          >
            {loading ? tc('saving') : onboarding ? t('completeProfile') : tc('save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
