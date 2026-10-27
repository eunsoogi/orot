import { ScrollView, StyleSheet, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { SelectedModelControl } from '../layout/SelectedModelControl';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import type { ProviderSelectionOption } from '../providers/selection/types';
import type { CandidateReview } from './classificationWorkflow';
import { MedicalAppointmentCandidateCard } from './MedicalAppointmentCandidateCard';
import { medicalAppointmentCopy as copy } from './copy.ko';
import { isConfidentMedical } from './saveCalendarCandidate';

interface Props {
  readonly provider: ProviderSelectionOption | null;
  readonly providerUnavailable: boolean;
  readonly providerReady: boolean;
  readonly loading: boolean;
  readonly calendarLoading: boolean;
  readonly calendarUnavailable: boolean;
  readonly classifying: boolean;
  readonly accessAvailable: boolean;
  readonly queryComplete: boolean;
  readonly message: string;
  readonly eventCount: number;
  readonly candidates: readonly CandidateReview[];
  readonly savingId: string | null;
  readonly savedIds: ReadonlySet<string>;
  readonly onImport: () => Promise<void>;
  readonly onOpenManual: () => void;
  readonly onOpenCalendarSettings?: () => void;
  readonly onOpenProviderSelection?: () => void;
}

/** One scroll owner keeps the import flow reachable while measured panels reflow. */
export function MedicalAppointmentReviewView(props: Props) {
  const inset = useNavigationContentInset();
  const busy =
    props.loading ||
    props.calendarLoading ||
    props.classifying ||
    props.savingId !== null;
  const classified = props.candidates.filter(
    item => item.status === 'classified',
  ).length;
  const unavailable =
    props.providerUnavailable ||
    props.provider?.availability.status === 'unavailable';
  return (
    <ScrollView
      testID="medical-appointment-review-scroll"
      style={styles.screen}
      contentContainerStyle={[styles.content, inset]}
      keyboardShouldPersistTaps="handled"
    >
      <AdaptiveColumns
        primary={
          <View
            style={styles.overviewPanel}
            testID="medical-appointment-overview"
          >
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={styles.title}>
                {copy.title}
              </Text>
            </View>
            <SelectedModelControl
              // Keep this action scan-friendly; missing execution details are explanatory status copy.
              name={props.provider?.displayName ?? copy.chooseProvider}
              local={props.provider?.privacyBoundary === 'on-device'}
              onPress={props.onOpenProviderSelection}
              label="진료 일정 분류에 사용할 AI 선택"
              testID="medical-appointment-select-provider"
            />
            <Text style={styles.secondary}>
              {props.provider?.privacyBoundary === 'on-device'
                ? copy.localNotice
                : copy.remoteNotice}
            </Text>
            <Text style={styles.description}>{copy.description}</Text>
            {unavailable ? (
              <Text accessibilityRole="alert">{copy.providerUnavailable}</Text>
            ) : null}
            {props.provider && !unavailable && !props.providerReady ? (
              <Text>{copy.noProvider}</Text>
            ) : null}
            {props.message ? (
              <Text accessibilityRole="alert">{props.message}</Text>
            ) : null}
            <View style={styles.actions}>
              <AppButton
                testID="medical-appointment-import"
                disabled={
                  !props.providerReady || busy || props.calendarUnavailable
                }
                onPress={() => {
                  props.onImport();
                }}
                accessibilityLabel={copy.loadCalendar}
                accessibilityState={{ busy }}
                title={
                  props.calendarLoading
                    ? copy.calendarSyncing
                    : props.loading
                      ? copy.loading
                      : props.classifying
                        ? copy.classifying
                        : copy.loadCalendar
                }
              />
              {props.calendarUnavailable && props.onOpenCalendarSettings ? (
                <AppButton
                  onPress={props.onOpenCalendarSettings}
                  testID="medical-appointment-calendar-settings"
                  title={copy.calendarSettings}
                  variant="secondary"
                />
              ) : null}
            </View>
          </View>
        }
        // Keep this stable subtree mounted so candidate disclosure state survives axis changes.
        secondary={
          <View
            style={styles.resultsPanel}
            testID="medical-appointment-results"
          >
            {props.eventCount > 0 ? (
              <View style={styles.results}>
                <Text style={styles.coverage} accessibilityLiveRegion="polite">
                  {copy.coverage(props.eventCount, classified)}
                </Text>
                <View style={styles.group}>
                  {props.candidates
                    .filter(isConfidentMedical)
                    .map(candidate => (
                      <MedicalAppointmentCandidateCard
                        key={candidate.candidateId}
                        candidate={candidate}
                        isSaved={props.savedIds.has(candidate.candidateId)}
                        isSaving={props.savingId === candidate.candidateId}
                      />
                    ))}
                </View>
              </View>
            ) : props.accessAvailable ? (
              <Text>{copy.emptyCoverage}</Text>
            ) : null}
            <View style={styles.footer}>
              <Text style={styles.secondary}>{copy.resultNotice}</Text>
              <AppButton
                variant="secondary"
                onPress={props.onOpenManual}
                testID="medical-appointment-manual"
                title={copy.manual}
              />
              <Text style={styles.limit}>
                {copy.queryLimit}{' '}
                {!props.queryComplete ? copy.incompleteCalendar : ''}
              </Text>
            </View>
          </View>
        }
        testID="medical-appointment-columns"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: appColors.background },
  content: { paddingHorizontal: 24, paddingTop: 20, gap: 24 },
  overviewPanel: { gap: 24 },
  resultsPanel: { gap: 24 },
  heading: { gap: 10 },
  title: { fontSize: 30, lineHeight: 39, fontWeight: '700' },
  description: { fontSize: 16, lineHeight: 24, color: appColors.secondary },
  secondary: { fontSize: 14, lineHeight: 22, color: appColors.secondary },
  actions: { gap: 8 },
  results: { gap: 16 },
  coverage: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  group: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: appColors.border,
  },
  footer: { gap: 12 },
  limit: { fontSize: 12, lineHeight: 19, color: appColors.secondary },
});
