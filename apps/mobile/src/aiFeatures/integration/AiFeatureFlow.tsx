import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Button, Text, View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { ExternalMedicalPublication } from '../../externalMedicalEvidence/europePmc';
import { ProviderSelectionFlow } from '../../providers/selection';
import type { ProviderSelectionNavigationState } from '../../providers/selection/ProviderSelectionFlow';
import { useInferenceConsent } from '../../agent/execution/useInferenceConsent';
import type { NavigationRouteActions } from '../../navigation/NavigationRouteAdapter';
import { getAiFeatureIntegrationCopy } from './copy';
import { createAiFeatureServices } from './featureServices';
import type { AiFeatureServiceDependencies } from './featureServices';
import { resolveSelectedAiProvider as resolveSelectedAi } from './provider';
import { EvidenceSourceDetailScreen } from './EvidenceSourceDetailScreen';
import type {
  AiFeatureRouteName,
  FeatureScreenRoute,
} from './aiFeatureNavigation';
import { isFeatureScreenRoute } from './aiFeatureNavigation';
import { AiFeatureFlowScreen } from './AiFeatureFlowScreen';
import type { VisitQuestionsRenderInput } from './AiFeatureFlowScreen';
import { styles } from './AiFeatureFlow.styles';
import { useProviderSelectionLeaveGuard } from './useProviderSelectionLeaveGuard';

const emptyProviderNavigationState: ProviderSelectionNavigationState = {
  hasPendingSelection: false,
  isSavingSelection: false,
  isSigningIn: false,
  revision: 0,
  inputRevision: 0,
};

export interface AiFeatureFlowProps {
  readonly navigation: NavigationRouteActions<AiFeatureRouteName>;
  readonly renderVisitQuestions?: (
    input: VisitQuestionsRenderInput,
  ) => ReactElement;
  readonly onOpenArticle: (
    publication: ExternalMedicalPublication,
  ) => void | Promise<void>;
  readonly serviceDependencies?: AiFeatureServiceDependencies;
}

/** Keeps source/provider overlays over the live feature route so drafts survive navigation. */
export function AiFeatureFlow({
  navigation,
  renderVisitQuestions,
  onOpenArticle,
  serviceDependencies,
}: AiFeatureFlowProps) {
  const [sourceReference, setSourceReference] =
    useState<EvidenceReference | null>(null);
  const [sourceReturnRoute, setSourceReturnRoute] =
    useState<FeatureScreenRoute>('entry');
  const [providerReturnRoute, setProviderReturnRoute] =
    useState<FeatureScreenRoute>('entry');
  const [selectedAiRevision, setSelectedAiRevision] = useState(0);
  const [articleOpenError, setArticleOpenError] = useState(false);
  const providerNavigationStateRef = useRef<ProviderSelectionNavigationState>(
    emptyProviderNavigationState,
  );
  const routeName = navigation.route.name;
  const providerSelectionOpen = routeName === 'provider-selection';
  const sourceDetailOpen = routeName === 'source-detail';
  const screenRoute = providerSelectionOpen
    ? providerReturnRoute
    : sourceDetailOpen
      ? sourceReturnRoute
      : isFeatureScreenRoute(routeName)
        ? routeName
        : 'entry';
  const { consent, disclosureSheet } = useInferenceConsent();
  const selectedAiDependencies = serviceDependencies?.selectedAi;
  // Provider refreshes follow the explicit selection revision, not render churn.
  const resolveSelectedAiForRoute = useCallback(
    () => resolveSelectedAi(selectedAiDependencies),
    [selectedAiDependencies],
  );
  const services = useMemo(
    () => createAiFeatureServices(consent, serviceDependencies),
    [consent, serviceDependencies],
  );
  const copy = getAiFeatureIntegrationCopy();
  const requestBack = useCallback(() => {
    navigation.onBack().then(
      () => undefined,
      () => undefined,
    );
  }, [navigation]);
  const openProviderSelection = () => {
    const returnRoute =
      routeName === 'source-detail'
        ? sourceReturnRoute
        : routeName === 'provider-selection'
          ? providerReturnRoute
          : isFeatureScreenRoute(routeName)
            ? routeName
            : 'entry';
    providerNavigationStateRef.current = { ...emptyProviderNavigationState };
    setProviderReturnRoute(returnRoute);
    if (!providerSelectionOpen) navigation.push('provider-selection');
  };
  const openSource = (reference: EvidenceReference) => {
    const returnRoute =
      routeName === 'provider-selection'
        ? providerReturnRoute
        : routeName === 'source-detail'
          ? sourceReturnRoute
          : isFeatureScreenRoute(routeName)
            ? routeName
            : 'entry';
    setSourceReference(reference);
    setSourceReturnRoute(returnRoute);
    if (!sourceDetailOpen) navigation.push('source-detail');
  };
  const openArticle = async (publication: ExternalMedicalPublication) => {
    try {
      await onOpenArticle(publication);
      setArticleOpenError(false);
    } catch {
      setArticleOpenError(true);
    }
  };
  const pushFeatureRoute = (route: FeatureScreenRoute) => {
    navigation.push(route);
  };
  const reportProviderNavigationState = useCallback(
    (state: ProviderSelectionNavigationState) => {
      providerNavigationStateRef.current = state;
    },
    [],
  );
  useProviderSelectionLeaveGuard(navigation, providerNavigationStateRef);

  return (
    <View style={styles.container} testID="ai-feature-flow">
      {!providerSelectionOpen && !sourceDetailOpen ? (
        <View style={styles.providerBar}>
          <Text style={styles.providerNotice}>{copy.selectedAiNotice}</Text>
          <Button
            onPress={openProviderSelection}
            testID="ai-feature-select-provider"
            title={copy.selectAi}
          />
        </View>
      ) : null}
      <View style={styles.screen}>
        {/* Keep feature ScrollViews mounted and bounded while an overlay is active. */}
        <View
          testID="ai-feature-screen-content"
          style={
            sourceDetailOpen || providerSelectionOpen
              ? styles.hiddenFeatureScreen
              : styles.featureScreen
          }
        >
          <AiFeatureFlowScreen
            route={screenRoute}
            renderVisitQuestions={renderVisitQuestions}
            onBack={requestBack}
            onOpenVisitQuestions={
              renderVisitQuestions
                ? () => pushFeatureRoute('visit-questions')
                : undefined
            }
            onOpenDiseaseHypotheses={() =>
              pushFeatureRoute('disease-hypotheses')
            }
            onOpenRagConversation={() => pushFeatureRoute('rag-conversation')}
            onOpenExternalEvidence={() => pushFeatureRoute('external-evidence')}
            onOpenProviderSelection={openProviderSelection}
            onOpenSource={openSource}
            resolveSelectedAi={resolveSelectedAiForRoute}
            selectedAiRevision={selectedAiRevision}
            services={services}
            onOpenArticle={publication => {
              openArticle(publication).then(
                () => undefined,
                () => undefined,
              );
            }}
          />
        </View>
        {sourceDetailOpen && sourceReference ? (
          <View style={styles.sourceOverlay}>
            <EvidenceSourceDetailScreen
              onBack={requestBack}
              readSource={services.readSource}
              reference={sourceReference}
            />
          </View>
        ) : null}
        {providerSelectionOpen ? (
          <View
            style={styles.sourceOverlay}
            testID="ai-feature-provider-overlay"
          >
            <ProviderSelectionFlow
              key={navigation.route.key}
              selectionStore={serviceDependencies?.selectedAi?.selectionStore}
              chatGPTServices={serviceDependencies?.selectedAi?.chatGPTServices}
              safeAreaHandledByParent
              onBack={requestBack}
              onNavigationStateChange={reportProviderNavigationState}
              onSelectionCommitted={() => {
                setSelectedAiRevision(revision => revision + 1);
                requestBack();
              }}
            />
          </View>
        ) : null}
      </View>
      {articleOpenError ? (
        <Text accessibilityRole="alert" testID="external-article-open-error">
          {copy.articleOpenError}
        </Text>
      ) : null}
      {disclosureSheet}
    </View>
  );
}
