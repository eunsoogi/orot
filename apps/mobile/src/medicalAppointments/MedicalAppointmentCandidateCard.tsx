import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { formatCalendarEventRange } from '../calendar/dateTime';
import { medicalAppointmentCopy as copy } from './copy.ko';
import type { CandidateReview } from './classificationWorkflow';

const styles = StyleSheet.create({
  card: {
    gap: 6,
    padding: 12,
    backgroundColor: appColors.surface,
    borderBottomColor: appColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
  },
  identity: { flex: 1, gap: 4 },
  title: { fontSize: 16, lineHeight: 23, fontWeight: '600' },
  badge: {
    backgroundColor: appColors.primarySoft,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: { color: appColors.primaryText, fontSize: 13, fontWeight: '600' },
  neutral: { backgroundColor: appColors.background },
  neutralText: { color: appColors.secondary },
  warning: { backgroundColor: appColors.warningSurface },
  warningText: { color: appColors.warning },
  date: { color: appColors.secondary, fontSize: 15, lineHeight: 23 },
  actionText: { color: appColors.primaryText, fontWeight: '600', fontSize: 16 },
  details: { gap: 6, paddingVertical: 4 },
});

interface MedicalAppointmentCandidateCardProps {
  readonly candidate: CandidateReview;
  readonly isSaved: boolean;
  readonly isSaving: boolean;
}

/** Read-only review explains automatic imports without offering per-event save actions. */
export function MedicalAppointmentCandidateCard({
  candidate,
  isSaved,
  isSaving,
}: MedicalAppointmentCandidateCardProps) {
  const [expanded, setExpanded] = useState(false);
  const classification = candidate.classification;
  const uncertain =
    candidate.status !== 'classified' || classification === 'uncertain';
  const nonMedical = classification === 'non_medical';
  return (
    <View style={styles.card}>
      <Pressable
        style={styles.heading}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(value => !value)}
        testID={`medical-appointment-details-${candidate.candidateId}`}
      >
        <View style={styles.identity}>
          <Text style={styles.title}>
            {candidate.event.calendarEventSnapshot.title ||
              candidate.event.effectiveAt}
          </Text>
          {/* Dates distinguish recurring titles without exposing EventKit identifiers. */}
          <Text style={styles.date}>
            {formatCalendarEventRange(candidate.event)}
          </Text>
        </View>
        <View
          style={[
            styles.badge,
            nonMedical && styles.neutral,
            uncertain && styles.warning,
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              nonMedical && styles.neutralText,
              uncertain && styles.warningText,
            ]}
          >
            {candidate.status === 'classified' && classification
              ? copy.labels[classification]
              : copy.unclassified}
          </Text>
        </View>
        <AppSymbol
          name={expanded ? 'chevron.down' : 'chevron.right'}
          size={16}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.details}>
          {candidate.reason ? (
            <Text>{`${copy.reason}: ${candidate.reason}`}</Text>
          ) : null}
          {candidate.uncertainty ? (
            <Text>{`${copy.uncertainty}: ${copy.labels[candidate.uncertainty]}`}</Text>
          ) : null}
        </View>
      ) : null}
      {isSaved || isSaving ? (
        <Text style={styles.actionText}>
          {isSaved ? copy.saved : copy.saving}
        </Text>
      ) : null}
    </View>
  );
}
