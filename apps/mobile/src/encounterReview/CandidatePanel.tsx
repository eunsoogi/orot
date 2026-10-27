import { StyleSheet, TextInput, View } from 'react-native';
import type { EncounterCandidate, EncounterPending } from '@orot/agent-runtime';
import { AppText } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { reviewCopy as copy } from './strings';
import { appColors } from '../layout/appColors';
import { useInputObservation } from './useInputObservation';

/** Identity, kind, speaker and evidence have no editor; only supported descriptive fields can change. */
export function CandidatePanel({
  candidate,
  pending,
  selected,
  onToggle,
  onEdit,
}: {
  candidate: EncounterCandidate;
  pending: EncounterPending;
  selected: boolean;
  onToggle: () => void;
  onEdit: (field: 'text' | 'dosageInstruction', text: string) => void;
}) {
  const onChangeText = useInputObservation(
    candidate.id === 'candidate-0',
    candidate.text,
    text => onEdit('text', text),
  );
  return (
    <View testID={`encounter-${candidate.id}`}>
      <AppText>
        {candidate.kind === 'medication'
          ? '약물 언급 · 화자 알 수 없음'
          : '계획 · 화자 알 수 없음'}
      </AppText>
      <AppButton
        title={selected ? copy.exclude : copy.include}
        accessibilityLabel={`${selected ? copy.exclude : copy.include}: ${candidate.text}`}
        accessibilityState={{ selected }}
        onPress={onToggle}
        testID={`encounter-select-${candidate.id}`}
        variant="secondary"
      />
      <TextInput
        multiline
        style={styles.input}
        value={candidate.text}
        accessibilityLabel={copy.text}
        maxLength={2000}
        onChangeText={onChangeText}
        testID={`encounter-text-${candidate.id}`}
      />
      {candidate.kind === 'medication' ? (
        <TextInput
          multiline
          style={styles.input}
          value={candidate.dosageInstruction ?? ''}
          maxLength={1000}
          accessibilityLabel={copy.dosage}
          onChangeText={text => onEdit('dosageInstruction', text)}
          testID={`encounter-dosage-${candidate.id}`}
        />
      ) : null}
      {candidate.evidence.map((evidence, index) => {
        const segment = pending.segments.find(
          value => value.id === evidence.segmentId,
        );
        return (
          <View
            key={index}
            testID={`encounter-evidence-${candidate.id}-${index}`}
          >
            <AppText>{evidence.quote}</AppText>
            <AppText>{`전사 버전 ${segment?.revision}`}</AppText>
            <AppText>{`원문 범위 ${evidence.startOffset}–${evidence.endOffset} · 녹음 ${segment?.audioRange.startMs}–${segment?.audioRange.endMs} ms`}</AppText>
          </View>
        );
      })}
      {pending.conflicts
        .filter(conflict => conflict.candidateId === candidate.id)
        .map(conflict => (
          <AppText
            key={conflict.recordId}
            accessibilityRole="alert"
          >{`충돌: ${conflict.description}`}</AppText>
        ))}
    </View>
  );
}
const styles = StyleSheet.create({
  input: {
    color: appColors.text,
    backgroundColor: appColors.background,
    borderColor: appColors.border,
    borderWidth: 1,
    borderRadius: 8,
    minHeight: 48,
    padding: 12,
  },
});
