import type { ReactNode } from 'react';
import type { DiseaseHypothesisAnalysis } from './types';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { AiResponseText } from '../layout/AiResponseText';
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
import { useAiCancellationAction } from '../agent/useAiCancellationAction';
import { EvidenceLinks } from './DiseaseEvidenceLinks';
import { SavedSummaryHistory } from './SavedSummaryHistory';
import type { SymptomSummaryHistory } from './savedSummaries';
import { SummaryHeader } from './SummaryHeader';
import { readableHypothesis } from './readableHypothesis';
import { DiseaseGenerationFeedback } from './DiseaseGenerationFeedback';

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

/** Presents the explicitly selected summary or assessment only after current-citation validation. */
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
  const hasSharedCancel = useAiCancellationAction(
    state.status === 'loading',
    cancel,
    'disease-hypotheses-cancel',
  );

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
        onOpenHistory={summaryHistory ? onOpenHistory : undefined}
      />
      {providerSelection}
      {summaryHistory ? (
        <SavedSummaryHistory
          history={summaryHistory}
          current={
            state.status === 'result' ? state.value.savedSummary : undefined
          }
          disabled={state.status === 'loading'}
          expanded={false}
          onRestore={restore}
        />
      ) : null}
      <Text>{onSummarize ? copy.summaryExplanation : copy.explanation}</Text>
      {onSummarize ? (
        <Button
          variant="neutral"
          disabled={state.status === 'loading'}
          accessibilityState={{ busy: state.status === 'loading' }}
          onPress={() => {
            void generate(onSummarize, 'summary');
          }}
          testID="symptom-summary-generate"
          title={
            canRetry && lastOperation === 'summary'
              ? copy.summaryRetry
              : copy.summaryGenerate
          }
        />
      ) : null}
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
      {state.status === 'loading' ? (
        <>
          <Text
            accessibilityLiveRegion="polite"
            testID="disease-hypotheses-activity"
          >
            {activity ?? copy.loading}
          </Text>
          {!hasSharedCancel ? (
            <Button
              onPress={cancel}
              testID="disease-hypotheses-cancel"
              title={copy.cancel}
            />
          ) : null}
        </>
      ) : null}
      {preview ? (
        <View style={styles.draft} testID="disease-hypotheses-draft">
          <Text style={styles.label}>
            {state.status === 'loading'
              ? copy.draftHeading
              : copy.incompleteHeading}
          </Text>
          <Text>
            {state.status === 'loading' ? copy.draftNote : copy.incompleteNote}
          </Text>
          <AiResponseText>{preview}</AiResponseText>
        </View>
      ) : null}
      <DiseaseGenerationFeedback
        state={state}
        summary={lastOperation === 'summary'}
        onOpenProviderSelection={onOpenProviderSelection}
      />
      {state.status === 'result' ? (
        <View style={styles.results} testID="disease-hypotheses-results">
          <Text testID="disease-hypotheses-search-scope">
            {state.value.presentation === 'symptom_summary'
              ? copy.summaryScope
              : '관련도가 높은 일부 기록을 바탕으로 정리했어요. 전체 병력을 확인한 진단은 아니에요.'}
          </Text>
          {state.value.hypotheses
            .map(readableHypothesis)
            .map((hypothesis, index) => (
              <View key={`${hypothesis.title}-${index}`} style={styles.card}>
                {hypothesis.supportingEvidence.every(
                  ref => ref.sourceKind === 'external_medical',
                ) ? (
                  <Text style={styles.label}>
                    의학 자료 참고 · 내 기록의 진단 결과가 아니에요.
                  </Text>
                ) : null}
                <Text accessibilityRole="header" style={styles.title}>
                  {hypothesis.title}
                </Text>
                <AiResponseText>{hypothesis.summary}</AiResponseText>
                {hypothesis.uncertainty ? (
                  <>
                    <Text style={styles.label}>{copy.uncertainty}</Text>
                    <Text>{hypothesis.uncertainty}</Text>
                  </>
                ) : null}
                <EvidenceLinks
                  title={copy.supporting}
                  references={hypothesis.supportingEvidence}
                  onOpenSource={onOpenSource}
                />
                {hypothesis.contraryEvidence.length > 0 ? (
                  <EvidenceLinks
                    title={copy.contrary}
                    references={hypothesis.contraryEvidence}
                    onOpenSource={onOpenSource}
                  />
                ) : state.value.presentation !== 'symptom_summary' ? (
                  <Text>{copy.noContrary}</Text>
                ) : null}
                {hypothesis.missingData.length > 0 ||
                state.value.presentation !== 'symptom_summary' ? (
                  <Text style={styles.label}>{copy.missingData}</Text>
                ) : null}
                {hypothesis.missingData.length === 0 &&
                state.value.presentation !== 'symptom_summary' ? (
                  <Text>{copy.noAdditionalInfo}</Text>
                ) : null}
                {hypothesis.missingData.map(item => (
                  <Text key={item}>• {item}</Text>
                ))}
              </View>
            ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
