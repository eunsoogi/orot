import { useCallback, useContext } from 'react';
import type { ReactElement } from 'react';
import type { ExecutionConsentPort } from '@orot/agent-runtime';
import { Alert, View } from 'react-native';
import { t } from '../../i18n';
import type { ExternalMedicalPublication } from '../../externalMedicalEvidence/europePmc';
import { ProviderSelectionFlow } from '../../providers/selection';
import type {
  ProviderSelection,
  ProviderSelectionOption,
} from '../../providers/selection';
import type { NavigationRouteActions } from '../../navigation/NavigationRouteAdapter';
import type {
  AiFeatureServiceDependencies,
  AiFeatureServices,
} from './featureServices';
import { resolveSelectedAiProvider as resolveSelectedAi } from './provider';
import { EvidenceSourceDetailScreen } from './EvidenceSourceDetailScreen';
import type { AiFeatureRouteName } from './aiFeatureNavigation';
import { AiFeatureFlowScreen } from './AiFeatureFlowScreen';
import type { VisitQuestionsRenderInput } from './AiFeatureFlowScreen';
import { styles } from './AiFeatureFlow.styles';
import { useAiFeatureFlowNavigation } from './useAiFeatureFlowNavigation';
import { useAiFeatureSharedNavigationState } from './AiFeatureSharedNavigationState';
import { NavigationPrimaryActionContext } from '../../navigation/useNavigationPrimaryAction';
import { useAppointmentReminderRuntime } from '../../appointmentReminders/AppointmentReminderContext';
import { requestDailyReportFromConversation } from './dailyReportConversationEntry';

export interface AiFeatureFlowProps {
  readonly isEntryCurrent?: () => boolean;
  readonly navigation: NavigationRouteActions<AiFeatureRouteName>;
  readonly consent: ExecutionConsentPort;
  readonly services: AiFeatureServices;
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
  consent,
  navigation,
  renderVisitQuestions,
  onOpenArticle,
  onProviderSelectionCommitted,
  serviceDependencies,
  services,
  isEntryCurrent,
}: AiFeatureFlowProps) {
  const primaryActionHost = useContext(NavigationPrimaryActionContext);
  const reminderRuntime = useAppointmentReminderRuntime();
  const { state: shared, setState: setShared } =
    useAiFeatureSharedNavigationState();
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
  const selectedAiDependencies = serviceDependencies?.selectedAi;
  // Provider refreshes follow the explicit selection revision, not render churn.
  const resolveSelectedAiForRoute = useCallback(
    () => resolveSelectedAi(selectedAiDependencies),
    [selectedAiDependencies],
  );
  const requestBack = useCallback(() => {
    navigation.onBack().then(
      () => undefined,
      () => undefined,
    );
  }, [navigation]);
  return (
    <View style={styles.container} testID="ai-feature-flow">
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
          {/* A hidden retained screen must not publish its action into the overlay's toolbar. */}
          <NavigationPrimaryActionContext.Provider
            value={
              sourceDetailOpen || providerSelectionOpen
                ? null
                : primaryActionHost
            }
          >
            <AiFeatureFlowScreen
              route={screenRoute}
              reportOwnsOperation={!sourceDetailOpen && !providerSelectionOpen}
              onOpenSavedAnalysis={() => pushFeatureRoute('saved-analysis')}
              onOpenSavedVisitQuestions={
                renderVisitQuestions
                  ? () => pushFeatureRoute('saved-visit-questions')
                  : undefined
              }
              articleOpenError={articleOpenError}
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
              onOpenDailyReportChat={target => {
                if (!isEntryCurrent?.() || !reminderRuntime) return;
                const route = pushFeatureRoute('rag-conversation');
                if (route)
                  reminderRuntime.dailyReportFollowUps.set(route.key, target);
              }}
              onOpenDailyReport={() => {
                requestDailyReportFromConversation({
                  feature: services.dailyReport,
                  runtime: reminderRuntime,
                  navigate: () => pushFeatureRoute('daily-report'),
                  now: new Date().toISOString(),
                  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  isCurrent: isEntryCurrent ?? (() => false),
                }).then(result => {
                  if (result === 'unavailable')
                    Alert.alert(
                      t('dailyReport.title'),
                      t('dailyReport.entryError'),
                    );
                });
              }}
              onOpenConversationHistory={() =>
                pushFeatureRoute('conversation-history')
              }
              onOpenSummaryHistory={() => {
                setShared(current => ({
                  ...current,
                  summaryReturnRouteKey: screenRouteKey,
                }));
                pushFeatureRoute('summary-history');
              }}
              restoredSummary={
                shared.summarySelection?.routeKey === screenRouteKey
                  ? shared.summarySelection.value
                  : undefined
              }
              onRestoreSummary={value => {
                // Target the retained originating scene; selecting history never invokes generation.
                const routeKey = shared.summaryReturnRouteKey;
                if (!routeKey) return;
                setShared(current => ({
                  ...current,
                  summarySelection: {
                    routeKey,
                    value,
                  },
                }));
                requestBack();
              }}
              onOpenExternalEvidence={() =>
                pushFeatureRoute('external-evidence')
              }
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
          </NavigationPrimaryActionContext.Provider>
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
    </View>
  );
}
