import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import type { EvidenceItem, EvidenceReference } from '@orot/agent-runtime';
import { FeatureEntryScreen } from '../FeatureEntryScreen';
import { DiseaseHypothesesScreen } from '../../diseaseHypotheses/DiseaseHypothesesScreen';
import { ConversationScreen } from '../../ragConversation/ConversationScreen';
import { ExternalMedicalEvidenceScreen } from '../../externalMedicalEvidence/ExternalMedicalEvidenceScreen';
import type { ExternalMedicalPublication } from '../../externalMedicalEvidence/europePmc';
import { ProviderSelectionFlow } from '../../providers/selection';
import { useInferenceConsent } from '../../agent/execution/useInferenceConsent';
import { getAiFeatureIntegrationCopy } from './copy';
import { createAiFeatureServices } from './featureServices';
import type { AiFeatureServiceDependencies } from './featureServices';
import { resolveSelectedAiProvider as resolveSelectedAi } from './provider';
import type { SelectedAiResolution } from './provider';
import { EvidenceSourceDetailScreen } from './EvidenceSourceDetailScreen';
import type { AiFeatureServices } from './featureServices';

type FeatureScreenRoute =
  | 'entry'
  | 'visit-questions'
  | 'disease-hypotheses'
  | 'rag-conversation'
  | 'external-evidence';
type FeatureRoute = FeatureScreenRoute | 'source-detail' | 'provider-selection';

export interface AiFeatureFlowProps {
  readonly renderVisitQuestions?: (input: {
    readonly onBack: () => void;
    readonly onOpenProviderSelection: () => void;
    /** Opens a registered local citation through the feature's source-detail route. */
    readonly onOpenSource: (reference: EvidenceItem) => void;
    /** Re-reads the exact saved provider/model after the selection route returns. */
    readonly resolveSelectedAi: () => Promise<SelectedAiResolution>;
    readonly selectedAiRevision: number;
    readonly loadSavedVisitQuestions: AiFeatureServices['loadSavedVisitQuestions'];
  }) => ReactElement;
  readonly onOpenArticle: (
    publication: ExternalMedicalPublication,
  ) => void | Promise<void>;
  readonly serviceDependencies?: AiFeatureServiceDependencies;
}

/** Keeps source and provider routes over the active feature so drafts survive navigation. */
export function AiFeatureFlow({
  renderVisitQuestions,
  onOpenArticle,
  serviceDependencies,
}: AiFeatureFlowProps) {
  const [route, setRoute] = useState<FeatureRoute>('entry');
  const [sourceReference, setSourceReference] =
    useState<EvidenceReference | null>(null);
  const [sourceReturnRoute, setSourceReturnRoute] =
    useState<FeatureScreenRoute>('entry');
  const [providerReturnRoute, setProviderReturnRoute] =
    useState<FeatureScreenRoute>('entry');
  const [selectedAiRevision, setSelectedAiRevision] = useState(0);
  const [articleOpenError, setArticleOpenError] = useState(false);
  const { consent, disclosureSheet } = useInferenceConsent();
  const services = useMemo(
    () => createAiFeatureServices(consent, serviceDependencies),
    [consent, serviceDependencies],
  );
  const copy = getAiFeatureIntegrationCopy();
  const openProviderSelection = () => {
    const returnRoute =
      route === 'source-detail'
        ? sourceReturnRoute
        : route === 'provider-selection'
          ? providerReturnRoute
          : route;
    setProviderReturnRoute(returnRoute);
    setRoute('provider-selection');
  };
  const openSource = (reference: EvidenceReference) => {
    const returnRoute =
      route === 'provider-selection'
        ? providerReturnRoute
        : route === 'source-detail'
          ? sourceReturnRoute
          : route;
    setSourceReference(reference);
    setSourceReturnRoute(returnRoute);
    setRoute('source-detail');
  };
  const openArticle = async (publication: ExternalMedicalPublication) => {
    try {
      await onOpenArticle(publication);
      setArticleOpenError(false);
    } catch {
      setArticleOpenError(true);
    }
  };

  const entryScreen = (
    <FeatureEntryScreen
      onOpenVisitQuestions={
        renderVisitQuestions ? () => setRoute('visit-questions') : undefined
      }
      onOpenDiseaseHypotheses={() => setRoute('disease-hypotheses')}
      onOpenRagConversation={() => setRoute('rag-conversation')}
      onOpenExternalEvidence={() => setRoute('external-evidence')}
    />
  );

  let screen: ReactElement;
  const screenRoute =
    route === 'source-detail'
      ? sourceReturnRoute
      : route === 'provider-selection'
        ? providerReturnRoute
        : route;
  switch (screenRoute) {
    case 'entry':
      screen = entryScreen;
      break;
    case 'visit-questions':
      screen = renderVisitQuestions
        ? renderVisitQuestions({
            onBack: () => setRoute('entry'),
            onOpenProviderSelection: openProviderSelection,
            onOpenSource: openSource,
            resolveSelectedAi: () =>
              resolveSelectedAi(serviceDependencies?.selectedAi),
            selectedAiRevision,
            loadSavedVisitQuestions: services.loadSavedVisitQuestions,
          })
        : entryScreen;
      break;
    case 'disease-hypotheses':
      screen = (
        <DiseaseHypothesesScreen
          onBack={() => setRoute('entry')}
          onGenerate={services.generateDiseaseHypotheses}
          onOpenSource={openSource}
        />
      );
      break;
    case 'rag-conversation':
      screen = (
        <ConversationScreen
          onBack={() => setRoute('entry')}
          onSend={services.sendRagMessage}
          onOpenSource={openSource}
        />
      );
      break;
    case 'external-evidence':
      screen = (
        <ExternalMedicalEvidenceScreen
          onBack={() => setRoute('entry')}
          service={services.externalEvidence}
          onOpenArticle={publication => {
            void openArticle(publication);
          }}
        />
      );
      break;
  }

  return (
    <View style={styles.container} testID="ai-feature-flow">
      {route !== 'provider-selection' && route !== 'source-detail' ? (
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
            route === 'source-detail' || route === 'provider-selection'
              ? styles.hiddenFeatureScreen
              : styles.featureScreen
          }
        >
          {screen}
        </View>
        {route === 'source-detail' && sourceReference ? (
          <View style={styles.sourceOverlay}>
            <EvidenceSourceDetailScreen
              onBack={() => setRoute(sourceReturnRoute)}
              readSource={services.readSource}
              reference={sourceReference}
            />
          </View>
        ) : null}
        {route === 'provider-selection' ? (
          <View
            style={styles.sourceOverlay}
            testID="ai-feature-provider-overlay"
          >
            <ProviderSelectionFlow
              selectionStore={serviceDependencies?.selectedAi?.selectionStore}
              chatGPTServices={serviceDependencies?.selectedAi?.chatGPTServices}
              onBack={() => setRoute(providerReturnRoute)}
              onSelectionCommitted={() => {
                setSelectedAiRevision(revision => revision + 1);
                setRoute(providerReturnRoute);
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  providerBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  providerNotice: { color: '#45524F', flex: 1, fontSize: 12 },
  screen: { flex: 1 },
  featureScreen: { flex: 1 },
  hiddenFeatureScreen: { display: 'none', flex: 1 },
  sourceOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'white',
  },
});
