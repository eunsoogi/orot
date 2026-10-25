import { createContext, useContext, useMemo, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { FeatureScreenRoute } from './aiFeatureNavigation';
import { NextVisitQuestionsSessionProvider } from './NextVisitQuestionsSession';
import { ConversationSessionsProvider } from '../../ragConversation/ConversationSessionsContext';
import type { DiseaseHypothesisAnalysis } from '../../diseaseHypotheses/types';

export interface AiFeatureSharedNavigationState {
  readonly summaryReturnRouteKey: string | null;
  readonly summarySelection: {
    readonly routeKey: string;
    readonly value: DiseaseHypothesisAnalysis;
  } | null;
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
  summaryReturnRouteKey: null,
  summarySelection: null,
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
      <ConversationSessionsProvider>
        <NextVisitQuestionsSessionProvider
          selectedAiRevision={state.selectedAiRevision}
        >
          {children}
        </NextVisitQuestionsSessionProvider>
      </ConversationSessionsProvider>
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
