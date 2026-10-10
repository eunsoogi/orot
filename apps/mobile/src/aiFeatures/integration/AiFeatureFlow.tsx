import { AppButton as Button } from '../../layout/AppButton';
import { useCallback, useMemo } from 'react';
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import type { ExternalMedicalPublication } from '../../externalMedicalEvidence/europePmc';
import { ProviderSelectionFlow } from '../../providers/selection';
import type {
  ProviderSelection,
  ProviderSelectionOption,
} from '../../providers/selection';
import { useInferenceConsent } from '../../agent/execution/useInferenceConsent';
import type { NavigationRouteActions } from '../../navigation/NavigationRouteAdapter';
import { getAiFeatureIntegrationCopy } from './copy';
import { createAiFeatureServices } from './featureServices';
import type { AiFeatureServiceDependencies } from './featureServices';
import { resolveSelectedAiProvider as resolveSelectedAi } from './provider';
import { EvidenceSourceDetailScreen } from './EvidenceSourceDetailScreen';
import type { AiFeatureRouteName } from './aiFeatureNavigation';
import { AiFeatureFlowScreen } from './AiFeatureFlowScreen';
import type { VisitQuestionsRenderInput } from './AiFeatureFlowScreen';
import { styles } from './AiFeatureFlow.styles';
import { useAiFeatureFlowNavigation } from './useAiFeatureFlowNavigation';

export interface AiFeatureFlowProps {
  readonly navigation: NavigationRouteActions<AiFeatureRouteName>;
  readonly renderVisitQuestions?: (
    input: VisitQuestionsRenderInput,
  ) => ReactElement;
  readonly onOpenArticle: (
    publication: ExternalMedicalPublication,
  ) => void | Promise<void>;
  /** Lets the home shortcut update its provider summary after selection is committed. */
  readonly onProviderSelectionCommitted?: (
    selection: ProviderSelection,
    provider: ProviderSelectionOption['provider'],
  ) => void;
  readonly serviceDependencies?: AiFeatureServiceDependencies;
}

/** Keeps source/provider overlays over the live feature route so drafts survive navigation. */
export function AiFeatureFlow({
  navigation,
  renderVisitQuestions,
  onOpenArticle,
  onProviderSelectionCommitted,
  serviceDependencies,
}: AiFeatureFlowProps) {
  const {
    articleOpenError,
    handleOpenArticle,
    openProviderSelection,
    openSource,
    providerSelectionOpen,
    pushFeatureRoute,
    reportFeatureNavigationState,
    reportProviderNavigationState,
    reportVisitQuestionsRouteState,
    screenRoute,
    screenRouteKey,
    selectedAiRevision,
    setSelectedAiRevision,
    sourceDetailOpen,
    sourceReference,
  } = useAiFeatureFlowNavigation(navigation, onOpenArticle);
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
            navigationRouteKey={screenRouteKey ?? undefined}
            onFeatureNavigationStateChange={reportFeatureNavigationState}
            renderVisitQuestions={renderVisitQuestions}
            onRouteStateChange={reportVisitQuestionsRouteState}
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
            confirmConsent={async request =>
              (await consent.authorize(request)) === 'authorized'
            }
            selectedAiRevision={selectedAiRevision}
            services={services}
            onOpenArticle={publication => {
              handleOpenArticle(publication).then(
                () => undefined,
                () => undefined,
              );
            }}
          />
        </View>
        {sourceDetailOpen && sourceReference ? (
          <View style={styles.sourceOverlay}>
            <EvidenceSourceDetailScreen
              navigationRouteKey={navigation.route.key}
              onNavigationStateChange={reportFeatureNavigationState}
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
              navigationRouteKey={navigation.route.key}
              selectionStore={serviceDependencies?.selectedAi?.selectionStore}
              chatGPTServices={serviceDependencies?.selectedAi?.chatGPTServices}
              safeAreaHandledByParent
              onBack={requestBack}
              onNavigationStateChange={reportProviderNavigationState}
              onSelectionCommitted={(selection, provider) => {
                setSelectedAiRevision(revision => revision + 1);
                onProviderSelectionCommitted?.(selection, provider);
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
