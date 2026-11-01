import type { ReactNode } from 'react';
import type { DiseaseHypothesisAnalysis } from './types';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { ScrollView, View } from 'react-native';
import { navigationText } from '../i18n/navigation';
import { styles } from './DiseaseHypothesesScreen.styles';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { AiFeatureNavigationStateChange } from '../aiFeatures/integration/useAiFeatureNavigationState';
import { useAiFeatureScreenNavigationState } from '../aiFeatures/integration/useAiFeatureNavigationState';
import { getDiseaseHypothesisCopy } from './copy';
import type { DiseaseHypothesisRunOutcome } from './task';
import type { AiWorkflowObserver } from '../agent/workflowActivity';
import { useDiseaseHypothesisGeneration } from './useDiseaseHypothesisGeneration';
import { SavedSummaryHistory } from './SavedSummaryHistory';
import type { SymptomSummaryHistory } from './savedSummaries';
import { SummaryHeader } from './SummaryHeader';
import { VerticalPageSections as AdaptiveColumns } from '../layout/VerticalPageSections';
import { DiseaseHypothesesScreenOutput } from './DiseaseHypothesesScreenOutput';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';

interface DiseaseHypothesesScreenProps {
  readonly onOpenHistory?: () => void;
  readonly restoredSummary?: DiseaseHypothesisAnalysis;
  readonly summaryHistory?: SymptomSummaryHistory;
  readonly providerSelection?: ReactNode;
  readonly navigationRouteKey?: string;
  readonly onNavigationStateChange?: AiFeatureNavigationStateChange;
  readonly onBack: () => void;
  readonly onOpenProviderSelection?: () => void;
  readonly onGenerate: (
    signal?: AbortSignal,
    observer?: AiWorkflowObserver,
  ) => Promise<DiseaseHypothesisRunOutcome>;
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly onSummarize?: DiseaseHypothesesScreenProps['onGenerate'];
}

/** Presents validated summaries and route-owned work in one page flow. */
export function DiseaseHypothesesScreen({
  onOpenHistory,
  restoredSummary,
  summaryHistory,
  providerSelection,
  onSummarize,
  navigationRouteKey,
  onNavigationStateChange,
  onBack,
  onOpenProviderSelection,
  onGenerate,
  onOpenSource,
}: DiseaseHypothesesScreenProps) {
  const navigationInset = useNavigationContentInset();
  const copy = getDiseaseHypothesisCopy();
  const { state, activity, preview, generate, cancel, restore, lastOperation } =
    useDiseaseHypothesisGeneration(onGenerate, restoredSummary);
  const canRetry =
    state.status === 'error' || state.status === 'consent_required';
  const hasOutput = state.status !== 'idle' || preview.length > 0;
  const busy = state.status === 'loading';
  const summaryLabel =
    canRetry && lastOperation === 'summary'
      ? copy.summaryRetry
      : copy.summaryGenerate;
  const assessmentLabel =
    canRetry && lastOperation === 'assessment' ? copy.retry : copy.generate;
  const hasDock = useNavigationRouteActions([
    ...(busy
      ? [
          {
            id: 'cancel-hypotheses',
            label: copy.cancel,
            accessibilityLabel: copy.cancel,
            testID: 'disease-hypotheses-cancel',
            systemImageName: 'xmark',
            onPress: cancel,
          },
        ]
      : []),
    ...(onSummarize
      ? [
          {
            id: 'generate-summary',
            label: summaryLabel,
            accessibilityLabel: summaryLabel,
            testID: 'symptom-summary-generate',
            systemImageName: 'text.alignleft',
            disabled: busy,
            busy,
            onPress: () => generate(onSummarize, 'summary'),
          },
        ]
      : []),
    {
      id: 'generate-hypotheses',
      label: assessmentLabel,
      accessibilityLabel: assessmentLabel,
      testID: 'disease-hypotheses-generate',
      systemImageName: 'sparkles',
      disabled: busy,
      busy,
      onPress: () => generate(),
    },
    ...(summaryHistory && onOpenHistory
      ? [
          {
            id: 'summary-history',
            label: '저장된 요약 보기',
            accessibilityLabel: '저장된 요약 보기',
            testID: 'symptom-summary-history-open',
            systemImageName: 'clock.arrow.circlepath',
            disabled: busy,
            onPress: onOpenHistory,
          },
        ]
      : []),
  ]);

  useAiFeatureScreenNavigationState(
    navigationRouteKey,
    {
      hasUnsavedChanges:
        state.status === 'result' &&
        state.value.savedSummary?.status !== 'saved',
      isRecording: false,
      // The request receives this signal and is aborted when a confirmed leave unmounts.
      hasOngoingOperation: state.status === 'loading',
    },
    0,
    onNavigationStateChange,
  );

  return (
    <ScrollView
      contentContainerStyle={[styles.container, navigationInset]}
      testID="disease-hypotheses-screen"
    >
      <AdaptiveColumns
        primary={
          <View style={styles.panel}>
            {navigationRouteKey ? null : (
              <Button
                accessibilityLabel={navigationText.back.accessibilityLabel}
                onPress={onBack}
                title={navigationText.back.label}
              />
            )}
            <SummaryHeader
              title={onSummarize ? copy.summaryTitle : copy.title}
              disabled={state.status === 'loading'}
              onOpenHistory={
                !hasDock && summaryHistory ? onOpenHistory : undefined
              }
            />
            {providerSelection}
            {summaryHistory ? (
              <SavedSummaryHistory
                history={summaryHistory}
                current={
                  state.status === 'result'
                    ? state.value.savedSummary
                    : undefined
                }
                disabled={state.status === 'loading'}
                expanded={false}
                onRestore={restore}
              />
            ) : null}
            <Text>
              {onSummarize ? copy.summaryExplanation : copy.explanation}
            </Text>
            {!hasDock && onSummarize ? (
              <Button
                variant="neutral"
                disabled={state.status === 'loading'}
                accessibilityState={{ busy: state.status === 'loading' }}
                onPress={() => {
                  generate(onSummarize, 'summary');
                }}
                testID="symptom-summary-generate"
                title={
                  canRetry && lastOperation === 'summary'
                    ? copy.summaryRetry
                    : copy.summaryGenerate
                }
              />
            ) : null}
            {!hasDock ? (
              <Button
                variant={onSummarize ? 'neutral' : 'primary'}
                disabled={state.status === 'loading'}
                accessibilityState={{ busy: state.status === 'loading' }}
                onPress={() => {
                  generate();
                }}
                testID="disease-hypotheses-generate"
                title={
                  canRetry && lastOperation === 'assessment'
                    ? copy.retry
                    : copy.generate
                }
              />
            ) : null}
          </View>
        }
        secondary={
          hasOutput ? (
            <DiseaseHypothesesScreenOutput
              state={state}
              activity={activity}
              preview={preview}
              lastOperation={lastOperation}
              hasSharedCancel={hasDock}
              onCancel={cancel}
              onOpenProviderSelection={onOpenProviderSelection}
              onOpenSource={onOpenSource}
            />
          ) : undefined
        }
        routeKey={navigationRouteKey}
        testID="disease-hypotheses-columns"
      />
    </ScrollView>
  );
}
