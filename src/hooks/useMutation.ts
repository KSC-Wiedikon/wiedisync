/**
 * useMutation — backward-compatible wrapper around TanStack mutations.
 *
 * New code should import { useCreate, useUpdate, useDelete } from '../lib/query' directly.
 */

import { useState, useCallback } from 'react'
import { createRecord, updateRecord, deleteRecord } from '../lib/api'
import { invalidateForCollection } from '../lib/query'
import { logActivity } from '../utils/logActivity'
import { toError } from '../utils/toError'

const SKIP_LOG = new Set(['user_logs'])

export function useMutation<T = Record<string, unknown>>(collection: string) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const create = useCallback(
    async (data: Record<string, unknown>, opts: { silentOnUnique?: boolean } = {}) => {
      setIsLoading(true)
      setError(null)
      try {
        const record = await createRecord<T>(collection, data, opts)
        const id = (record as Record<string, unknown>).id
        if (!SKIP_LOG.has(collection)) logActivity('create', collection, String(id), data)
        invalidateForCollection(collection)
        return record
      } catch (err) {
        const e = toError(err)
        setError(e)
        throw e
      } finally {
        setIsLoading(false)
      }
    },
    [collection],
  )

  const update = useCallback(
    async (id: string | number, data: Record<string, unknown>) => {
      setIsLoading(true)
      setError(null)
      try {
        const record = await updateRecord<T>(collection, id, data)
        if (!SKIP_LOG.has(collection)) logActivity('update', collection, String(id), data)
        invalidateForCollection(collection)
        return record
      } catch (err) {
        const e = toError(err)
        setError(e)
        throw e
      } finally {
        setIsLoading(false)
      }
    },
    [collection],
  )

  const remove = useCallback(
    async (id: string | number) => {
      setIsLoading(true)
      setError(null)
      try {
        await deleteRecord(collection, id)
        if (!SKIP_LOG.has(collection)) logActivity('delete', collection, String(id))
        invalidateForCollection(collection)
        return true
      } catch (err) {
        const e = toError(err)
        setError(e)
        throw e
      } finally {
        setIsLoading(false)
      }
    },
    [collection],
  )

  return { create, update, remove, isLoading, error }
}
