import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, Trash2, Pencil, Globe, X, Upload } from 'lucide-react'
import { logActivity } from '../../utils/logActivity'
import { getFileUrl } from '../../utils/fileUrl'
import { Button } from '../../components/ui/button'
import IconButton from '../../components/IconButton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { Input } from '../../components/ui/input'
import { Switch } from '../../components/ui/switch'
import { Label } from '../../components/ui/label'
import ConfirmDialog from '../../components/ConfirmDialog'
import EmptyState from '../../components/EmptyState'
import type { Team, Sponsor } from '../../types'
import { createRecord, deleteRecord, fetchAllItems, updateRecord, uploadFile } from '../../lib/api'
import { hasApiErrorCode } from '../../lib/apiErrorCode'
import { sanitizeUrl } from '../../utils/sanitizeUrl'

export default function TeamSponsorsEditor({ team }: { team: Team }) {
  const { t } = useTranslation('teams')
  const [sponsors, setSponsors] = useState<Sponsor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form fields
  const [name, setName] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [teamPageOnly, setTeamPageOnly] = useState(true)

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Sponsor | null>(null)

  // Written as a promise chain rather than async/await: every setState here already
  // ran *after* the request resolved, but the compiler inlines an async callback
  // into its effect call site and cannot see the `await` boundary, so it reported
  // these as synchronous setState-in-effect. `.then()/.catch()/.finally()` is the
  // same desugaring `await` produces — identical timing, same resolved value.
  const fetchSponsors = useCallback(() => {
    return fetchAllItems<Sponsor>('sponsors', {
      filter: { teams: { teams_id: { _eq: team.id } } },
      sort: ['sort_order'],
    })
      .then((records) => {
        setSponsors(records)
      })
      .catch(() => {
        // silently ignore fetch errors
      })
      .finally(() => {
        setLoading(false)
      })
  }, [team.id])

  useEffect(() => {
    fetchSponsors()
  }, [fetchSponsors])

  const resetForm = () => {
    setName('')
    setWebsiteUrl('')
    setLogoFile(null)
    setTeamPageOnly(true)
    setEditingId(null)
    setShowForm(false)
  }

  const openEditForm = (sp: Sponsor) => {
    setEditingId(sp.id)
    setName(sp.name)
    setWebsiteUrl(sp.website_url ?? '')
    setTeamPageOnly(sp.team_page_only ?? true)
    setLogoFile(null)
    setShowForm(true)
  }

  const handleSubmit = async () => {
    if (!name.trim()) return

    try {
      // Upload the logo to /files first (multipart), then reference it by id in
      // the plain-JSON payload. Passing FormData straight to create/updateRecord
      // is a silent no-op: the Directus SDK JSON.stringifies the body and
      // JSON.stringify(FormData) === '{}'. File fields go through POST /files.
      const payload: Record<string, unknown> = {
        name: name.trim(),
        website_url: websiteUrl.trim(),
        team_page_only: teamPageOnly,
        active: true,
      }
      if (logoFile) {
        const { id: fileId } = await uploadFile(logoFile)
        payload.logo = fileId
      }

      if (editingId) {
        await updateRecord('sponsors', editingId, payload)
        logActivity('update', 'sponsors', editingId, { name: name.trim(), website_url: websiteUrl.trim(), team_page_only: teamPageOnly })
      } else {
        // M2M write uses junction-object format ({ teams_id }), not a flat id
        // array — flat arrays trigger a junction-PK lookup that 403s non-admins.
        payload.teams = [{ teams_id: team.id }]
        payload.sort_order = sponsors.length
        const created = await createRecord<{id: string}>('sponsors', payload)
        logActivity('create', 'sponsors', created.id, { name: name.trim(), website_url: websiteUrl.trim(), team_page_only: teamPageOnly })
      }
      toast.success(t('sponsorSaved'))
      resetForm()
      fetchSponsors()
    } catch (err) {
      toast.error(hasApiErrorCode(err, 'FILE_NOT_YOURS') ? t('common:fileNotYours') : t('sponsorSaveError'))
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteRecord('sponsors', deleteTarget.id)
      logActivity('delete', 'sponsors', deleteTarget.id, { name: deleteTarget.name })
      toast.success(t('sponsorDeleted'))
      setDeleteTarget(null)
      fetchSponsors()
    } catch {
      toast.error(t('sponsorDeleteError'))
    }
  }

  const handleTeamPageOnlyToggle = async (sp: Sponsor) => {
    try {
      const next = !sp.team_page_only
      await updateRecord('sponsors', sp.id, { team_page_only: next })
      logActivity('update', 'sponsors', sp.id, { team_page_only: next })
      setSponsors((prev) => prev.map((s) => (s.id === sp.id ? { ...s, team_page_only: next } : s)))
    } catch {
      toast.error(t('sponsorUpdateError'))
    }
  }

  if (loading) return null

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{t('teamSponsors')}</h2>
        {!showForm && (
          <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('addSponsor')}
          </Button>
        )}
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div className="mt-3 space-y-3 rounded-2xl border border-hairline bg-card p-4 shadow-card">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
              {editingId ? t('editSponsor') : t('addSponsor')}
            </span>
            <IconButton size="sm" type="button" onClick={resetForm} label={t('common:close')} className="shrink-0 text-muted-foreground/80 hover:text-foreground">
              <X />
            </IconButton>
          </div>

          <div className="space-y-2">
            <div>
              <Label htmlFor="sponsor-name">{t('sponsorName')}</Label>
              <Input id="sponsor-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('sponsorName')} />
            </div>
            <div>
              <Label htmlFor="sponsor-website">{t('sponsorWebsite')}</Label>
              <Input id="sponsor-website" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <Label htmlFor="sponsor-logo">{t('sponsorLogo')}</Label>
              <div className="flex items-center gap-2">
                <label
                  htmlFor="sponsor-logo"
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground/85 transition-colors hover:bg-accent dark:bg-transparent"
                >
                  <Upload className="h-4 w-4" />
                  {logoFile ? logoFile.name : t('sponsorLogo')}
                </label>
                <input id="sponsor-logo" type="file" accept="image/*" className="hidden" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="sponsor-team-page-only" checked={teamPageOnly} onCheckedChange={setTeamPageOnly} />
              <div>
                <Label htmlFor="sponsor-team-page-only">{t('teamPageOnly')}</Label>
                <p className="text-xs text-muted-foreground">{t('teamPageOnlyHint')}</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={resetForm}>
              {t('common:cancel')}
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={!name.trim()}>
              {t('common:save')}
            </Button>
          </div>
        </div>
      )}

      {/* Sponsor list */}
      {sponsors.length === 0 && !showForm ? (
        <div className="mt-3">
          <EmptyState title={t('teamSponsors')} description={t('addSponsor')} />
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-2xl border border-hairline bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="w-14 hidden sm:table-cell" />
                <TableHead className="text-muted-foreground">{t('sponsorName')}</TableHead>
                <TableHead className="text-center text-muted-foreground">{t('teamPageOnly')}</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sponsors.map((sp) => {
                const safeUrl = sanitizeUrl(sp.website_url || '')
                return (
                  <TableRow key={sp.id} className="border-border">
                    <TableCell className="hidden sm:table-cell">
                      {sp.logo ? (
                        <img src={getFileUrl('sponsors', sp.id, sp.logo)} alt={sp.name} className="h-12 w-12 shrink-0 rounded object-contain" />
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground/80">
                          <Upload className="h-5 w-5" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm font-medium text-foreground">{sp.name}</p>
                      {safeUrl ? (
                        <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline dark:text-brand-300">
                          <Globe className="h-3 w-3" />
                          {safeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </a>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch checked={sp.team_page_only} onCheckedChange={() => handleTeamPageOnlyToggle(sp)} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:justify-end">
                        <IconButton size="sm" type="button" onClick={() => openEditForm(sp)} label={t('common:edit')} className="text-muted-foreground/80 hover:text-foreground">
                          <Pencil />
                        </IconButton>
                        <IconButton size="sm" type="button" onClick={() => setDeleteTarget(sp)} label={t('common:delete')} className="text-muted-foreground/80 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400">
                          <Trash2 />
                        </IconButton>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t('deleteSponsor')}
        message={t('deleteSponsorConfirm', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('common:remove')}
        danger
      />
    </div>
  )
}
