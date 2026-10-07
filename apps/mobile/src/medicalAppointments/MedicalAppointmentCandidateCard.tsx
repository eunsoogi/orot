import { Button, StyleSheet, Text, View } from 'react-native';
import { formatCalendarEventRange } from '../calendar/dateTime';
import { medicalAppointmentCopy as copy } from './copy.ko';
import type { CandidateReview } from './classificationWorkflow';

const styles = StyleSheet.create({
  card: { gap: 6, padding: 12, backgroundColor: 'white' },
});

interface MedicalAppointmentCandidateCardProps {
  readonly candidate: CandidateReview;
  readonly disabled: boolean;
  readonly isSaved: boolean;
  readonly isSaving: boolean;
  readonly onSave: (candidate: CandidateReview) => Promise<void>;
}

/** Keeps the model explanation beside the user's explicit save action. */
export function MedicalAppointmentCandidateCard({
  candidate,
  disabled,
  isSaved,
  isSaving,
  onSave,
}: MedicalAppointmentCandidateCardProps) {
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header">
        {candidate.event.calendarEventSnapshot.title ||
          candidate.event.effectiveAt}
      </Text>
      {/* Keep repeated titles distinguishable without showing a private EventKit identifier. */}
      <Text>{formatCalendarEventRange(candidate.event)}</Text>
      <Text>
        {candidate.status === 'classified' && candidate.classification
          ? copy.labels[candidate.classification]
          : copy.unclassified}
      </Text>
      {candidate.reason ? (
        <Text>{`${copy.reason}: ${candidate.reason}`}</Text>
      ) : null}
      {candidate.uncertainty ? (
        <Text>{`${copy.uncertainty}: ${copy.labels[candidate.uncertainty]}`}</Text>
      ) : null}
      <Button
        disabled={disabled || isSaved}
        onPress={() => onSave(candidate)}
        testID={`medical-appointment-save-${candidate.candidateId}`}
        title={isSaved ? copy.saved : isSaving ? copy.saving : copy.save}
      />
    </View>
  );
}
