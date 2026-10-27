import type { EvidenceReference } from '@orot/agent-runtime';
import { View } from 'react-native';
import { AiResponseText } from '../layout/AiResponseText';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { EvidenceLinks } from './DiseaseEvidenceLinks';
import { DiseaseGenerationFeedback } from './DiseaseGenerationFeedback';
import { getDiseaseHypothesisCopy } from './copy';
import { readableHypothesis } from './readableHypothesis';
import { styles } from './DiseaseHypothesesScreen.styles';
import type { DiseaseGenerationState } from './useDiseaseHypothesisGeneration';

/** Presents the active generation state and validated evidence in the secondary screen panel. */
export function DiseaseHypothesesScreenOutput({
  state,
  activity,
  preview,
  lastOperation,
  hasSharedCancel,
  onCancel,
  onOpenProviderSelection,
  onOpenSource,
}: {
  readonly state: DiseaseGenerationState;
  readonly activity?: string;
  readonly preview: string;
  readonly lastOperation: 'summary' | 'assessment';
  readonly hasSharedCancel: boolean;
  readonly onCancel: () => void;
  readonly onOpenProviderSelection?: () => void;
  readonly onOpenSource: (reference: EvidenceReference) => void;
}) {
  const copy = getDiseaseHypothesisCopy();

  return (
    <View style={styles.panel}>
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
              onPress={onCancel}
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
    </View>
  );
}
