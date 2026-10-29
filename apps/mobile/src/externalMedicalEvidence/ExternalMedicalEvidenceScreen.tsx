import { useInferenceConsent } from '../agent/execution/useInferenceConsent';
import { publicMedicalQueryConsent } from '../agent/execution/publicMedicalQueryConsent';
import type { ReactNode } from 'react';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { getExternalMedicalEvidenceCopy } from './copy';
import type { AiFeatureNavigationStateChange } from '../aiFeatures/integration/useAiFeatureNavigationState';
import { useAiFeatureScreenNavigationState } from '../aiFeatures/integration/useAiFeatureNavigationState';
import type {
  EuropePmcMedicalEvidenceService,
  EuropePmcSearchResult,
  ExternalMedicalPublication,
} from './europePmc';
import {
  ExternalMedicalEvidencePresentation,
  externalMedicalEvidencePublicationKey,
} from './ExternalMedicalEvidencePresentation';
import type { ExternalMedicalEvidenceSearchState } from './ExternalMedicalEvidencePresentation';

interface ExternalMedicalEvidenceScreenProps {
  readonly providerSelection?: ReactNode;
  readonly navigationRouteKey?: string;
  readonly onNavigationStateChange?: AiFeatureNavigationStateChange;
  readonly onBack: () => void;
  readonly service: EuropePmcMedicalEvidenceService;
  readonly onOpenArticle: (publication: ExternalMedicalPublication) => void;
}

/** Owns consent, request progress, and selected literature for the adaptive screen. */
export function ExternalMedicalEvidenceScreen({
  providerSelection,
  navigationRouteKey,
  onNavigationStateChange,
  onBack,
  service,
  onOpenArticle,
}: ExternalMedicalEvidenceScreenProps) {
  const navigationInset = useNavigationContentInset();
  const copy = getExternalMedicalEvidenceCopy();
  const [query, setQuery] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const { consent, disclosureSheet } = useInferenceConsent();
  const queryConsent = publicMedicalQueryConsent(consent);
  const [state, setState] = useState<ExternalMedicalEvidenceSearchState>({
    status: 'idle',
  });
  const operationController = useRef<AbortController | null>(null);
  const inputRevision = useRef(0);

  useAiFeatureScreenNavigationState(
    navigationRouteKey,
    {
      hasUnsavedChanges:
        query.length > 0 ||
        state.status === 'available' ||
        state.status === 'empty' ||
        state.status === 'unavailable',
      isRecording: false,
      // Search supports AbortSignal; confirmed route removal cancels the fetch.
      hasOngoingOperation: state.status === 'loading',
    },
    inputRevision.current,
    onNavigationStateChange,
  );

  useEffect(
    () => () => {
      operationController.current?.abort();
      operationController.current = null;
    },
    [],
  );

  async function search() {
    if (!query.trim() || state.status === 'loading') return;
    const submittedQuery = query.trim();
    const controller = new AbortController();
    operationController.current = controller;
    setState({ status: 'loading' });
    try {
      const decision = await queryConsent.authorize({
        operationRunId: 'manual-medical-search',
        operationKey: 'search',
        sourceId: 'europe-pmc',
        query: submittedQuery,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (decision !== 'authorized') {
        setState({ status: 'consent_required' });
        return;
      }
      const result: EuropePmcSearchResult = await service.search(
        submittedQuery,
        {
          externalQueryConsented: true,
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted) return;
      setState(searchResultState(result));
    } catch {
      if (!controller.signal.aborted) setState({ status: 'unavailable' });
    } finally {
      if (operationController.current === controller) {
        operationController.current = null;
      }
    }
  }

  function selectPublication(publication: ExternalMedicalPublication) {
    const selectedKey = externalMedicalEvidencePublicationKey(publication);
    setState(current => {
      if (
        current.status !== 'available' ||
        !current.publications.some(
          item => externalMedicalEvidencePublicationKey(item) === selectedKey,
        )
      ) {
        return current;
      }
      // Selection stays with response state so measured reflow cannot reset the chosen source.
      return { ...current, selectedKey };
    });
  }

  function handleSearch() {
    search().catch(() => setState({ status: 'unavailable' }));
  }

  return (
    <>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.container, navigationInset]}
        keyboardShouldPersistTaps="handled"
        testID="external-medical-evidence-screen"
      >
        <ExternalMedicalEvidencePresentation
          copy={copy}
          inputFocused={inputFocused}
          onBack={onBack}
          onInputBlur={() => setInputFocused(false)}
          onInputFocus={() => setInputFocused(true)}
          onOpenArticle={onOpenArticle}
          onQueryChange={value => {
            inputRevision.current += 1;
            setQuery(value);
          }}
          onSearch={handleSearch}
          onSelectPublication={selectPublication}
          providerSelection={providerSelection}
          query={query}
          showBack={!navigationRouteKey}
          state={state}
        />
      </ScrollView>
      {disclosureSheet}
    </>
  );
}

function searchResultState(
  result: EuropePmcSearchResult,
): ExternalMedicalEvidenceSearchState {
  if (result.status === 'available') {
    const firstPublication = result.publications[0];
    return firstPublication
      ? {
          status: 'available',
          publications: result.publications,
          selectedKey: externalMedicalEvidencePublicationKey(firstPublication),
        }
      : { status: 'empty' };
  }
  return { status: result.status === 'empty' ? 'empty' : 'unavailable' };
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20 },
});
