import { StyleSheet, TextInput, View } from 'react-native';
import type { EncounterCandidate, EncounterPending } from '@orot/agent-runtime';
import { AppText } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { reviewCopy as copy } from './strings';
import { appColors } from '../layout/appColors';
import { useInputObservation } from './useInputObservation';

/** Keeps identity, kind, speaker and evidence fixed while supported text fields stay editable in one reflowing card. */
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
    <View style={styles.card} testID={`encounter-${candidate.id}`}>
      <View style={styles.heading}>
        <AppText accessibilityRole="header" style={styles.kind}>
          {candidate.kind === 'medication' ? '약물 언급' : '계획'}
        </AppText>
        <AppText style={styles.speaker}>화자 알 수 없음</AppText>
      </View>
      <AppButton
        title={selected ? copy.exclude : copy.include}
        accessibilityLabel={`${selected ? copy.exclude : copy.include}: ${candidate.text}`}
        accessibilityState={{ selected }}
        onPress={onToggle}
        testID={`encounter-select-${candidate.id}`}
        variant="secondary"
      />
      <View style={styles.fields}>
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
      </View>
      <View style={styles.evidenceList}>
        {candidate.evidence.map((evidence, index) => {
          const segment = pending.segments.find(
            value => value.id === evidence.segmentId,
          );
          return (
            <View
              key={index}
              style={styles.evidence}
              testID={`encounter-evidence-${candidate.id}-${index}`}
            >
              <AppText>{evidence.quote}</AppText>
              <AppText style={styles.evidenceDetail}>
                {`전사 버전 ${segment?.revision}`}
              </AppText>
              <AppText style={styles.evidenceDetail}>
                {`원문 범위 ${evidence.startOffset}–${evidence.endOffset} · 녹음 ${segment?.audioRange.startMs}–${segment?.audioRange.endMs} ms`}
              </AppText>
            </View>
          );
        })}
      </View>
      {pending.conflicts
        .filter(conflict => conflict.candidateId === candidate.id)
        .map(conflict => (
          <View key={conflict.recordId} style={styles.conflict}>
            <AppText accessibilityRole="alert" style={styles.conflictText}>
              {`충돌: ${conflict.description}`}
            </AppText>
          </View>
        ))}
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    gap: 12,
    padding: 16,
    borderRadius: 12,
    backgroundColor: appColors.background,
    borderColor: appColors.border,
    borderWidth: 1,
  },
  heading: { gap: 4 },
  kind: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  speaker: { color: appColors.secondary },
  fields: { gap: 12 },
  evidenceList: { gap: 8 },
  evidence: {
    gap: 6,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: appColors.border,
    borderLeftWidth: 3,
    borderLeftColor: appColors.primary,
    backgroundColor: appColors.surface,
  },
  evidenceDetail: { color: appColors.secondary, lineHeight: 20 },
  conflict: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.warningSurface,
  },
  conflictText: { color: appColors.warning, lineHeight: 22 },
  input: {
    color: appColors.text,
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderWidth: 1,
    borderRadius: 8,
    minHeight: 72,
    padding: 12,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
});
