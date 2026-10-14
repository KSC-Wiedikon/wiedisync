import { useMemo, useState, type ReactNode } from 'react'
import { useFinanceFiscalYears } from '../../../hooks/useFinance'
import { AccountingFyContext, FY_STORAGE_KEY } from './fyContext'

function readStored(): string {
  try { return localStorage.getItem(FY_STORAGE_KEY) ?? '' } catch { return '' }
}

/** Holds the fiscal year for the whole accounting app; remembered per browser. The
 *  default is the newest year (the list comes newest first). */
export default function FyProvider({ children }: { children: ReactNode }) {
  const { data, isError } = useFinanceFiscalYears()
  const [picked, setPicked] = useState<string>(readStored)
  const value = useMemo(() => {
    const years = data ?? []
    const fy = years.find((y) => String(y.id) === picked) ?? years[0]
    return {
      years,
      fyId: fy ? String(fy.id) : '',
      fyLabel: fy?.label ?? '',
      fy,
      // An error must not leave every page waiting forever.
      loading: data === undefined && !isError,
      setFyId: (id: string) => {
        setPicked(id)
        try { localStorage.setItem(FY_STORAGE_KEY, id) } catch { /* private mode */ }
      },
    }
  }, [data, isError, picked])
  return <AccountingFyContext.Provider value={value}>{children}</AccountingFyContext.Provider>
}
