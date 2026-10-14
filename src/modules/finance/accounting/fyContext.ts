import { createContext, useContext } from 'react'
import type { FinanceFiscalYear } from '../types'

/** The fiscal year picked in the accounting app's header — ONE picker for every page. */
export interface AccountingFy {
  years: FinanceFiscalYear[]
  /** '' until the years have loaded. */
  fyId: string
  fyLabel: string
  fy: FinanceFiscalYear | undefined
  loading: boolean
  setFyId: (id: string) => void
}

export const AccountingFyContext = createContext<AccountingFy>({
  years: [], fyId: '', fyLabel: '', fy: undefined, loading: true, setFyId: () => {},
})

export function useAccountingFy(): AccountingFy {
  return useContext(AccountingFyContext)
}

export const FY_STORAGE_KEY = 'kscw.accounting.fy'
