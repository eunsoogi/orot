import { createContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { SymptomFilter } from './types';

export const SymptomFilterContext = createContext<{
  filter: SymptomFilter;
  setFilter: (filter: SymptomFilter) => void;
} | null>(null);

/** Retains the selected query when Back removes the journal route, without persisting health data. */
export function SymptomFilterProvider({ children }: { children: ReactNode }) {
  const [filter, setFilter] = useState<SymptomFilter>({});
  const value = useMemo(() => ({ filter, setFilter }), [filter]);
  return (
    <SymptomFilterContext.Provider value={value}>
      {children}
    </SymptomFilterContext.Provider>
  );
}
