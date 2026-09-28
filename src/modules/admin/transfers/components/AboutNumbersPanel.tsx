import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { Button } from '../../../../components/ui/button'
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '../../../../components/ui/collapsible'

/**
 * The caveats the numbers on this page cannot be read correctly without.
 *
 * ⚠ Every sentence here is preserved VERBATIM from the always-on prose block
 * this replaces, because each one is a ONE-WAY implication an admin will
 * otherwise get backwards: "not found in VIS" is a lead and not a verdict,
 * "not validated" says we have no confirmation and never why, the settled tally
 * counts BOTH settled cohorts, and the two derived pills are computed rather
 * than stored so the way to change them is to change what they are derived from.
 *
 * Nothing is deleted — it moves from ~100 words above the first actionable row
 * to a collapsed panel below the worklist, and the same strings power the
 * HintPopovers on the chips and pills they qualify.
 */
export function AboutNumbersPanel() {
  const { t } = useTranslation('admin')
  return (
    <Collapsible className="mt-6">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="group">
          <ChevronRight
            className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90"
            aria-hidden="true"
          />
          {t('trAboutNumbersTitle')}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-3 rounded-xl border border-hairline bg-surface-sunken px-4 py-3 text-xs text-muted-foreground">
          <section>
            <h3 className="text-xs font-semibold text-foreground/85">
              {t('trVisSummaryTitle')}
            </h3>
            <p className="mt-0.5">{t('trVisSummaryHint')}</p>
          </section>
          <section>
            <h3 className="text-xs font-semibold text-foreground/85">
              {t('trColLicenceValidated')}
            </h3>
            <p className="mt-0.5">{t('trLicenceHint')}</p>
          </section>
          <section>
            <h3 className="text-xs font-semibold text-foreground/85">
              {t('trDiagSettledTitle')}
            </h3>
            <p className="mt-0.5">{t('trSettledDescription')}</p>
          </section>
          <section>
            <h3 className="text-xs font-semibold text-foreground/85">
              {t('trDerivedOurs')}
            </h3>
            <p className="mt-0.5">{t('trDerivedOursHint')}</p>
          </section>
          <section>
            <h3 className="text-xs font-semibold text-foreground/85">
              {t('trDerivedVm')}
            </h3>
            <p className="mt-0.5">{t('trDerivedVmHint')}</p>
          </section>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
