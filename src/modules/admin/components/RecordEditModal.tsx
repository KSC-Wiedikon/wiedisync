import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { createRecord, updateRecord, deleteRecord, uploadFile } from '../../../lib/api'
import { logActivity } from '../../../utils/logActivity'
import { formatDateTimeCompactZurich, toUtcIsoFromDatetimeLocal, toDatetimeLocalFromUtcIso } from '../../../utils/dateHelpers'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ConfirmDialog'
import LocationCombobox from '@/components/LocationCombobox'
import DateTimePicker from '@/components/ui/DateTimePicker'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import type { LocationResult } from '@/types'

interface SchemaField {
  id: string
  name: string
  type: string
  required: boolean
  options: Record<string, unknown>
}

interface RecordEditModalProps {
  open: boolean
  onClose: () => void
  collection: string
  schema: SchemaField[]
  record?: Record<string, unknown> | null
  onSaved: () => void
}

const inputClass =
  'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'

export default function RecordEditModal({
  open,
  onClose,
  collection,
  schema,
  record,
  onSaved,
}: RecordEditModalProps) {
  const { t } = useTranslation('admin')
  const isEdit = !!record
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [fileFields, setFileFields] = useState<Record<string, File | null>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Initialize form data when record or schema changes
  useEffect(() => {
    if (!open) return
    const data: Record<string, unknown> = {}
    for (const field of schema) {
      if (field.type === 'file') continue // files handled separately
      if (record) {
        data[field.name] = record[field.name] ?? ''
      } else {
        // New record: use proper defaults per field type
        const maxSelect = (field.options?.maxSelect as number) || 1
        if (field.type === 'relation' && maxSelect > 1) {
          data[field.name] = []
        } else if (field.type === 'select' && maxSelect > 1) {
          data[field.name] = []
        } else if (field.type === 'bool') {
          data[field.name] = false
        } else {
          data[field.name] = ''
        }
      }
    }
    setFormData(data)
    setFileFields({})
    setError(null)
  }, [open, record, schema])

  const setField = (name: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const isHallsCollection = collection === 'halls'

  const handleLocationSelect = (result: LocationResult) => {
    setFormData((prev) => ({
      ...prev,
      name: result.name,
      address: result.address,
      city: result.city,
      ...(result.lat != null && result.lon != null
        ? { maps_url: `https://www.google.com/maps/search/?api=1&query=${result.lat},${result.lon}` }
        : {}),
    }))
  }

  const handleSave = async () => {
    setLoading(true)
    setError(null)
    try {
      // Clean up data — convert empty strings to null/typed values per field type.
      const cleanData: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(formData)) {
        const field = schema.find((f) => f.name === key)
        if (field?.type === 'number' && value !== '' && value !== null) {
          cleanData[key] = Number(value)
        } else if (field?.type === 'bool') {
          cleanData[key] = Boolean(value)
        } else if (field?.type === 'json' && typeof value === 'string' && value) {
          try {
            cleanData[key] = JSON.parse(value)
          } catch {
            cleanData[key] = value
          }
        } else if (field?.type === 'relation') {
          const maxSelect = (field.options?.maxSelect as number) || 1
          if (maxSelect > 1) {
            // Multi-relation: ensure array
            cleanData[key] = Array.isArray(value) ? value : (value === '' || value == null) ? [] : [value]
          } else {
            // Single relation: empty string is fine (PB treats as null)
            cleanData[key] = value === '' ? '' : value
          }
        } else {
          cleanData[key] = value
        }
      }

      // Upload any file fields to /files first (multipart), then reference each
      // by id in the plain-JSON payload. Passing FormData straight to
      // create/updateRecord is a silent no-op — the Directus SDK JSON.stringifies
      // the body and both File and FormData serialize to '{}'. File fields must
      // go through POST /files.
      for (const [key, file] of Object.entries(fileFields)) {
        if (file) {
          const { id: fileId } = await uploadFile(file)
          cleanData[key] = fileId
        }
      }

      if (isEdit) {
        await updateRecord(collection, record!.id as string | number, cleanData)
        logActivity('update', collection, String(record!.id), cleanData)
      } else {
        const rec = await createRecord<Record<string, unknown>>(collection, cleanData)
        logActivity('create', collection, String(rec.id), cleanData)
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!record) return
    setLoading(true)
    try {
      await deleteRecord(collection, record.id as string | number)
      logActivity('delete', collection, String(record.id))
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  const renderField = (field: SchemaField) => {
    const value = formData[field.name]

    switch (field.type) {
      case 'text':
      case 'url':
      case 'editor':
        // Show LocationCombobox for hall name field in halls collection
        if (isHallsCollection && field.name === 'name') {
          return (
            <LocationCombobox
              value={String(value ?? '')}
              onChange={(v) => setField(field.name, v)}
              onSelect={handleLocationSelect}
              className="mt-1"
            />
          )
        }
        return (
          <input
            type="text"
            value={String(value ?? '')}
            onChange={(e) => setField(field.name, e.target.value)}
            className={inputClass}
          />
        )
      case 'email':
        return (
          <input
            type="email"
            value={String(value ?? '')}
            onChange={(e) => setField(field.name, e.target.value)}
            className={inputClass}
          />
        )
      case 'number':
        return (
          <input
            type="number"
            value={value === '' || value === null || value === undefined ? '' : String(value)}
            onChange={(e) => setField(field.name, e.target.value)}
            className={inputClass}
          />
        )
      case 'bool':
        return (
          <div className="mt-1 flex items-center gap-2">
            <Switch checked={Boolean(value)} onCheckedChange={(checked) => setField(field.name, checked)} />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {Boolean(value) ? 'true' : 'false'}
            </span>
          </div>
        )
      case 'date':
      case 'autodate':
        return (
          <DateTimePicker
            value={
              (() => {
                const v = String(value ?? '')
                if (!v) return ''
                // If already a datetime-local string (no Z/offset), use as-is
                if (!v.includes('Z') && !/[+-]\d{2}:?\d{2}$/.test(v)) return v.slice(0, 16)
                return toDatetimeLocalFromUtcIso(v)
              })()
            }
            onChange={(v) => setField(field.name, v ? toUtcIsoFromDatetimeLocal(v) : '')}
          />
        )
      case 'select': {
        const options = (field.options?.values as string[]) || []
        const maxSelect = (field.options?.maxSelect as number) || 1
        if (maxSelect > 1) {
          // Multi-select: render as checkboxes
          const selected = Array.isArray(value) ? (value as string[]) : []
          return (
            <div className="mt-1 flex flex-wrap gap-2">
              {options.map((opt) => (
                <label key={opt} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <Checkbox
                    checked={selected.includes(opt)}
                    onCheckedChange={(checked) => {
                      const next = checked
                        ? [...selected, opt]
                        : selected.filter((s) => s !== opt)
                      setField(field.name, next)
                    }}
                  />
                  <span className="text-gray-700 dark:text-gray-300">{opt}</span>
                </label>
              ))}
            </div>
          )
        }
        return (
          <select
            value={String(value ?? '')}
            onChange={(e) => setField(field.name, e.target.value)}
            className={inputClass}
          >
            <option value="">–</option>
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        )
      }
      case 'json':
        return (
          <textarea
            value={
              typeof value === 'object' && value !== null
                ? JSON.stringify(value, null, 2)
                : String(value ?? '')
            }
            onChange={(e) => setField(field.name, e.target.value)}
            rows={4}
            className={`${inputClass} font-mono`}
          />
        )
      case 'relation':
        return (
          <input
            type="text"
            value={
              Array.isArray(value) ? (value as string[]).join(', ') : String(value ?? '')
            }
            onChange={(e) => {
              const maxSelect = (field.options?.maxSelect as number) || 1
              if (maxSelect > 1) {
                setField(
                  field.name,
                  e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                )
              } else {
                setField(field.name, e.target.value.trim())
              }
            }}
            placeholder="Record ID(s)"
            className={inputClass}
          />
        )
      case 'file':
        return (
          <div className="mt-1">
            {isEdit && !!record?.[field.name] && (
              <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">
                {Array.isArray(record[field.name])
                  ? (record[field.name] as string[]).join(', ')
                  : String(record[field.name])}
              </p>
            )}
            <input
              type="file"
              onChange={(e) =>
                setFileFields((prev) => ({ ...prev, [field.name]: e.target.files?.[0] ?? null }))
              }
              className="text-sm text-gray-700 dark:text-gray-300"
            />
          </div>
        )
      default:
        return (
          <input
            type="text"
            value={String(value ?? '')}
            onChange={(e) => setField(field.name, e.target.value)}
            className={inputClass}
          />
        )
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={isEdit ? `${t('editRecord')} — ${record?.id}` : t('createRecord')}
        size="lg"
      >
        <div className="space-y-4">
          {isEdit && record && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              <span>ID: <code className="font-mono">{String(record.id)}</code></span>
              <span>Created: {formatDateTimeCompactZurich(String(record.date_created ?? record.created ?? ''))}</span>
              <span>Updated: {formatDateTimeCompactZurich(String(record.date_updated ?? record.updated ?? ''))}</span>
            </div>
          )}

          {schema.map((field) => (
            <div key={field.id}>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {field.name}
                {field.required && <span className="ml-1 text-red-500">*</span>}
                <span className="ml-2 font-normal normal-case text-gray-400">{field.type}</span>
              </label>
              {renderField(field)}
            </div>
          ))}

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <div>
              {isEdit && (
                <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)}>
                  {t('deleteRecord')}
                </Button>
              )}
            </div>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={onClose}>
                {t('cancel')}
              </Button>
              <Button
                onClick={handleSave}
                disabled={loading}
                loading={loading}
              >
                {loading ? '...' : t('save')}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title={t('deleteRecord')}
        message={t('deleteRecordMessage')}
        danger
      />
    </>
  )
}
