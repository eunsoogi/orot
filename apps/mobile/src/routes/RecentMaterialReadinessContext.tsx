import { createContext } from 'react';
import type { PropsWithChildren } from 'react';
import type { RecentMaterialReadyLease } from '../generatedReports/certifiedRecentMaterialPage';
import { useLegacyMemoryMaintenance } from '../storage/useLegacyMemoryMaintenance';

/** Neither Records route can mint a direct-read lease from its own state. */
export const RecentMaterialReadinessContext = createContext<
  RecentMaterialReadyLease | undefined
>(undefined);

/** Separate state owner; publishing a lease does not rerender the App root. */
export function RecentMaterialReadinessHost({ children }: PropsWithChildren) {
  const ready = useLegacyMemoryMaintenance();
  return (
    <RecentMaterialReadinessContext.Provider value={ready}>
      {children}
    </RecentMaterialReadinessContext.Provider>
  );
}
