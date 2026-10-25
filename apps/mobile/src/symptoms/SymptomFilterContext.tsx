import { createContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { SymptomEntryFilter } from '@orot/storage';

export const SymptomFilterContext = createContext<{
  filter: SymptomEntryFilter;
  setFilter: (filter: SymptomEntryFilter) => void;
} | null>(null);

/** Retains the selected query when Back removes the journal route, without persisting health data. */
export function SymptomFilterProvider({ children }: { children: ReactNode }) {
  const [filter, setFilter] = useState<SymptomEntryFilter>({});
  const value = useMemo(() => ({ filter, setFilter }), [filter]);
  return (
    <SymptomFilterContext.Provider value={value}>
      {children}
    </SymptomFilterContext.Provider>
  );
}
