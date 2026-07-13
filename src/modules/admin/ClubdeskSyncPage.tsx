import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpFromLine, ArrowDownToLine, FolderSync, HeartPulse } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import ClubdeskMemberSyncButton from './components/ClubdeskMemberSyncButton'
import ClubdeskSyncUpModal from './components/ClubdeskSyncUpModal'
import ClubdeskGroupCheck from './components/ClubdeskGroupCheck'

/**
 * Standalone ClubDesk sync page (superadmin) — the same sync-down button +
 * sync-up modal that live on the Anmeldungen page header, surfaced as their own
 * admin-nav destination so the sync isn't hidden behind the registrations
 * workflow. Field-level drift detail stays on Data health.
 */
export default function ClubdeskSyncPage() {
  const { t } = useTranslation('admin')
  const [syncUpOpen, setSyncUpOpen] = useState(false)

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <FolderSync className="h-6 w-6" />{t('clubdeskSyncTitle')}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('clubdeskSyncDescription')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowDownToLine className="h-4 w-4" />{t('clubdeskSyncDownTitle')}
            </CardTitle>
            <CardDescription>{t('clubdeskSyncDownDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ClubdeskMemberSyncButton />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowUpFromLine className="h-4 w-4" />{t('clubdeskSyncUpTitle')}
            </CardTitle>
            <CardDescription>{t('clubdeskSyncUpDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="outline" size="sm" onClick={() => setSyncUpOpen(true)} className="gap-2">
              <ArrowUpFromLine className="h-4 w-4" />{t('clubdeskUpButton')}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Group check — ClubDesk groups are manual-only, so they drift silently */}
      <ClubdeskGroupCheck />

      <p className="text-xs text-gray-500 dark:text-gray-400">
        <HeartPulse className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
        {t('clubdeskSyncDriftHint')}{' '}
        <Link to="/admin/data-health" className="underline underline-offset-2">{t('clubdeskSyncDriftLinkLabel')}</Link>
      </p>

      <ClubdeskSyncUpModal open={syncUpOpen} onOpenChange={setSyncUpOpen} />
    </div>
  )
}
