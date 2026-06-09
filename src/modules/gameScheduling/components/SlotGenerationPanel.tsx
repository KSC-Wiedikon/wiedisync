import { useTranslation } from 'react-i18next'

interface Props {
  seasonStatus: 'setup' | 'open' | 'closed'
  generating: boolean
  genResult: { total_created: number } | null
  /** True once slots already exist for the season → button becomes a yellow "Regenerate". */
  hasSlots: boolean
  onGenerate: () => Promise<void>
}

export default function SlotGenerationPanel({ seasonStatus, generating, genResult, hasSlots, onGenerate }: Props) {
  const { t } = useTranslation('gameScheduling')

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">{t('generateSlots')}</h2>

      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">{t('slotGenerationDescription')}</p>

      <button
        onClick={onGenerate}
        disabled={generating || seasonStatus === 'closed'}
        className={`rounded-md px-6 py-2.5 text-sm font-medium disabled:opacity-50 ${
          hasSlots
            ? 'bg-gold-400 text-brand-900 hover:bg-gold-500'
            : 'bg-green-600 text-white hover:bg-green-700'
        }`}
      >
        {generating ? t('generatingSlots') : hasSlots ? t('regenerateSlots') : t('generateSlots')}
      </button>

      {genResult && (
        <div className="mt-3 rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-900/30 dark:text-green-300">
          {t('slotsGenerated', { count: genResult.total_created })}
        </div>
      )}
    </div>
  )
}
