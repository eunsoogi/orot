import { createContext, useContext, useMemo, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { FeatureScreenRoute } from './aiFeatureNavigation';

export interface AiFeatureSharedNavigationState {
  readonly sourceReference: EvidenceReference | null;
  readonly sourceReturnRoute: FeatureScreenRoute;
  readonly sourceReturnRouteKey: string | null;
  readonly providerReturnRoute: FeatureScreenRoute;
  readonly providerReturnRouteKey: string | null;
  readonly selectedAiRevision: number;
  readonly articleOpenError: boolean;
}

interface AiFeatureSharedNavigationStateContextValue {
  readonly state: AiFeatureSharedNavigationState;
  readonly setState: Dispatch<SetStateAction<AiFeatureSharedNavigationState>>;
}

const initialState: AiFeatureSharedNavigationState = {
  sourceReference: null,
  sourceReturnRoute: 'entry',
  sourceReturnRouteKey: null,
  providerReturnRoute: 'entry',
  providerReturnRouteKey: null,
  selectedAiRevision: 0,
  articleOpenError: false,
};

const AiFeatureSharedNavigationStateContext =
  createContext<AiFeatureSharedNavigationStateContextValue | null>(null);

/** Shares overlay data across native scenes retained behind the active screen. */
export function AiFeatureSharedNavigationStateProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [state, setState] = useState(initialState);
  const value = useMemo(() => ({ state, setState }), [state]);
  return (
    <AiFeatureSharedNavigationStateContext.Provider value={value}>
      {children}
    </AiFeatureSharedNavigationStateContext.Provider>
  );
}

export function useAiFeatureSharedNavigationState() {
  const context = useContext(AiFeatureSharedNavigationStateContext);
  if (!context) {
    throw new Error('AI feature navigation needs its shared state provider.');
  }
  return context;
}
