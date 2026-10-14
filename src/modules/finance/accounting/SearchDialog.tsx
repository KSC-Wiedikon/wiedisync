import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Hash } from 'lucide-react'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from '../../../hooks/useAuth'
import { useFinanceAccounts } from '../../../hooks/useFinance'
import { MEMBER_APP_ORIGIN } from '../../../lib/api'
import { openExternalApp } from '../../../utils/pwa'
import { MEMBER_APP_LINKS, pagesFor, searchScore } from './nav'

/**
 * "Where is …?" — one search over every page (label, description and German +
 * English synonyms), every account (number or name → its account statement) and
 * the finance pages that live in the member app. Ctrl/⌘ K anywhere.
 */
export default function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation('finance')
  const navigate = useNavigate()
  const { isRevisor } = useAuth()
  const { data: accounts } = useFinanceAccounts(open)
  const pages = pagesFor(isRevisor)

  const go = (path: string) => { onOpenChange(false); navigate(path) }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0">
        <DialogTitle className="sr-only">{t('accSearchTitle')}</DialogTitle>
        <DialogDescription className="sr-only">{t('accSearchHint')}</DialogDescription>
        <Command filter={searchScore} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          <CommandInput placeholder={t('accSearchPlaceholder')} />
          <CommandList className="max-h-[min(70vh,28rem)]">
            <CommandEmpty>{t('accSearchEmpty')}</CommandEmpty>
            <CommandGroup heading={t('accSearchPages')}>
              {pages.map((p) => (
                <CommandItem
                  key={p.key}
                  value={`page:${p.key}`}
                  keywords={[t(`accNav_${p.key}`), t(`accNavDesc_${p.key}`), p.keywords]}
                  onSelect={() => go(p.path)}
                  className="min-h-11 gap-3"
                >
                  <p.icon className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block font-medium text-foreground">{t(`accNav_${p.key}`)}</span>
                    <span className="block truncate text-xs text-muted-foreground" title={t(`accNavDesc_${p.key}`)}>{t(`accNavDesc_${p.key}`)}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            {(accounts ?? []).length > 0 && (
              <CommandGroup heading={t('accSearchAccounts')}>
                {(accounts ?? []).map((a) => (
                  <CommandItem
                    key={a.id}
                    value={`account:${a.number}`}
                    keywords={[`${a.number} ${a.name}`]}
                    onSelect={() => go(`/accounts?acc=${encodeURIComponent(a.number)}`)}
                    className="min-h-11 gap-3"
                  >
                    <Hash className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 break-words"><span className="tabular-nums text-muted-foreground">{a.number}</span> {a.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!isRevisor && (
              <CommandGroup heading={t('accGroup_memberApp')}>
                {MEMBER_APP_LINKS.map((l) => (
                  <CommandItem
                    key={l.key}
                    value={`member:${l.key}`}
                    keywords={[t(`accLink_${l.key}`), l.keywords]}
                    onSelect={() => { onOpenChange(false); openExternalApp(`${MEMBER_APP_ORIGIN}${l.path}`) }}
                    className="min-h-11 gap-3"
                  >
                    <l.icon className="shrink-0 text-muted-foreground" />
                    <span className="flex-1">{t(`accLink_${l.key}`)}</span>
                    <ExternalLink className="!h-4 !w-4 shrink-0 text-muted-foreground" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
