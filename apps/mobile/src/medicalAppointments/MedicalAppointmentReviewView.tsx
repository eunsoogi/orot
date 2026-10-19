import { ScrollView, StyleSheet, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
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
}

/** One import action shows full scan progress and only confidently medical results. */
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
      style={styles.screen}
      contentContainerStyle={[styles.content, inset]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>
          {copy.title}
        </Text>
        <Text style={styles.description}>{copy.description}</Text>
      </View>
      <View style={styles.provider}>
        <View style={styles.symbol}>
          <AppSymbol
            name={
              props.provider?.privacyBoundary === 'on-device'
                ? 'apple.logo'
                : 'sparkles'
            }
            size={30}
            color={appColors.text}
          />
        </View>
        <View style={styles.providerCopy}>
          <Text style={styles.providerName}>
            {props.provider?.displayName ?? copy.noProvider}
          </Text>
          <Text style={styles.secondary}>
            {props.provider?.privacyBoundary === 'on-device'
              ? copy.localNotice
              : copy.remoteNotice}
          </Text>
        </View>
      </View>
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
          disabled={!props.providerReady || busy || props.calendarUnavailable}
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
      </View>
      {props.calendarUnavailable && props.onOpenCalendarSettings ? (
        <AppButton
          onPress={props.onOpenCalendarSettings}
          testID="medical-appointment-calendar-settings"
          title={copy.calendarSettings}
          variant="secondary"
        />
      ) : null}
      {props.eventCount > 0 ? (
        <View style={styles.results}>
          <Text style={styles.coverage} accessibilityLiveRegion="polite">
            {copy.coverage(props.eventCount, classified)}
          </Text>
          <View style={styles.group}>
            {props.candidates.filter(isConfidentMedical).map(candidate => (
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: appColors.background },
  content: { paddingHorizontal: 24, paddingTop: 20, gap: 24 },
  heading: { gap: 10 },
  title: { fontSize: 30, lineHeight: 39, fontWeight: '700' },
  description: { fontSize: 16, lineHeight: 24, color: appColors.secondary },
  provider: {
    backgroundColor: appColors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: appColors.border,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    minHeight: 80,
  },
  symbol: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: appColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerCopy: { flex: 1, gap: 6 },
  providerName: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
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
