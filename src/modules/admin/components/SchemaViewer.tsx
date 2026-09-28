import { useTranslation } from 'react-i18next'

interface SchemaField {
  id: string
  name: string
  type: string
  required: boolean
  options: Record<string, unknown>
}

interface SchemaViewerProps {
  schema: SchemaField[]
  collectionType?: string
}

const TYPE_COLORS: Record<string, string> = {
  text: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  editor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  number: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  bool: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  email: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  url: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  date: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  autodate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  select: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  relation: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  file: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  json: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${TYPE_COLORS[type] || 'bg-muted text-muted-foreground'}`}
    >
      {type}
    </span>
  )
}

function formatOptions(field: SchemaField): string {
  const o = field.options
  if (!o || Object.keys(o).length === 0) return ''
  if (field.type === 'select' && o.values) return (o.values as string[]).join(', ')
  if (field.type === 'relation' && o.collectionId) return `→ ${o.collectionId}`
  if (field.type === 'file' && o.maxSelect) return `max ${o.maxSelect}`
  if (field.type === 'number' && (o.min !== undefined || o.max !== undefined))
    return `${o.min ?? ''}..${o.max ?? ''}`
  return ''
}

export default function SchemaViewer({ schema, collectionType }: SchemaViewerProps) {
  const { t } = useTranslation('admin')

  const systemFields = [
    { name: 'id', type: 'text', note: 'auto-generated' },
    { name: 'created', type: 'autodate', note: '' },
    { name: 'updated', type: 'autodate', note: '' },
  ]

  if (collectionType === 'auth') {
    systemFields.push(
      { name: 'email', type: 'email', note: 'auth' },
      { name: 'verified', type: 'bool', note: 'auth' },
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-hairline bg-card">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-border bg-surface-sunken">
          <tr>
            <th className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('columnName')}</th>
            <th className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('type')}</th>
            <th className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('required')}</th>
            <th className="h-9 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('options')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {systemFields.map((f) => (
            <tr key={f.name} className="text-muted-foreground">
              <td className="px-3 py-1.5 font-mono">{f.name}</td>
              <td className="px-3 py-1.5"><TypeBadge type={f.type} /></td>
              <td className="px-3 py-1.5">–</td>
              <td className="px-3 py-1.5 text-muted-foreground/80">{f.note}</td>
            </tr>
          ))}
          {schema.map((field) => (
            <tr key={field.id}>
              <td className="px-3 py-1.5 font-mono text-foreground">{field.name}</td>
              <td className="px-3 py-1.5"><TypeBadge type={field.type} /></td>
              <td className="px-3 py-1.5 text-foreground/85">{field.required ? 'Yes' : '–'}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{formatOptions(field)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
