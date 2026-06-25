import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Play } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { fetchAllItems } from '../../../lib/api'

export interface TemplateParam {
  name: string
  type: 'relation' | 'date' | 'text' | 'number'
  collection?: string // for relation type
}

interface TemplateParamFormProps {
  params: TemplateParam[]
  onRun: (values: Record<string, string>) => void
  isRunning?: boolean
}

interface RelationOption {
  id: string
  name: string
}

function toTitleCase(str: string): string {
  return str
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function TemplateParamForm({ params, onRun, isRunning }: TemplateParamFormProps) {
  const { t } = useTranslation('admin')
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(params.map((p) => [p.name, '']))
  )
  const [relationOptions, setRelationOptions] = useState<Record<string, RelationOption[]>>({})

  // Reset values when params change
  useEffect(() => {
    setValues(Object.fromEntries(params.map((p) => [p.name, ''])))
  }, [params])

  // Fetch relation options for all relation-type params
  useEffect(() => {
    const relationParams = params.filter((p) => p.type === 'relation' && p.collection)
    if (relationParams.length === 0) return

    const uniqueCollections = [...new Set(relationParams.map((p) => p.collection!))]

    uniqueCollections.forEach(async (collection) => {
      try {
        const records = await fetchAllItems(collection, { fields: ['*'] })
        const options: RelationOption[] = records.map((r) => ({
          id: String(r['id']),
          name: String(r['name'] ?? ([r['last_name'], r['first_name']].filter(Boolean).join(' ') || r['title'] || r['id'])),
        }))
        setRelationOptions((prev) => ({ ...prev, [collection]: options }))
      } catch {
        // collection may not exist or user lacks access — silently ignore
      }
    })
  }, [params])

  const handleChange = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onRun(values)
  }

  if (params.length === 0) return null

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end">
      {params.map((param) => (
        <div key={param.name} className="flex flex-col gap-1 min-w-[140px]">
          <label className="text-xs font-medium text-muted-foreground">
            {toTitleCase(param.name)}
          </label>
          {param.type === 'relation' ? (
            <select
              value={values[param.name] ?? ''}
              onChange={(e) => handleChange(param.name, e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-800"
            >
              <option value="">—</option>
              {(relationOptions[param.collection ?? ''] ?? []).map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
          ) : (
            <Input
              type={param.type}
              value={values[param.name] ?? ''}
              onChange={(e) => handleChange(param.name, e.target.value)}
              className="min-w-[140px]"
            />
          )}
        </div>
      ))}
      <Button
        type="submit"
        size="sm"
        disabled={isRunning}
        className="bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <Play className="mr-1.5 h-3.5 w-3.5" />
        {t('runTemplate')}
      </Button>
    </form>
  )
}
