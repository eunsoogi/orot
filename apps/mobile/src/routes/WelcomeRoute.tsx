import { Pressable, StyleSheet, View } from 'react-native';
import type { Appointment } from '@orot/storage';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { formatDateTime, t } from '../i18n';
import { appColors } from '../layout/appColors';
import { formatRecordedAt } from '../recording/formatRecordedAt';
import { useNavigationLeaveStateRegistration } from '../navigation';

interface WelcomeRouteProps {
  readonly appointment: Appointment | null;
  readonly appointmentState: 'loading' | 'ready' | 'failed';
  readonly recentRecording: RecordingSourceRecord | null;
  readonly recordingState: 'loading' | 'ready' | 'failed';
  readonly onRetryAppointments: () => void;
  readonly onRetryRecordings: () => void;
  readonly onPrepareVisit: () => void;
  readonly onOpenSchedule: () => void;
  readonly onOpenRecords: () => void;
}

/** Shows only the next real appointment and the most recent saved source on Home. */
export default function WelcomeRoute({
  appointment,
  appointmentState,
  recentRecording,
  recordingState,
  onRetryAppointments,
  onRetryRecordings,
  onPrepareVisit,
  onOpenSchedule,
  onOpenRecords,
}: WelcomeRouteProps) {
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });

  const nextAppointment =
    appointment &&
    appointment.status !== 'cancelled' &&
    Date.parse(appointment.effectiveAt) > Date.now()
      ? appointment
      : null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text
          accessibilityRole="header"
          style={styles.title}
          testID="welcome-title"
        >
          {t('app.welcome.title')}
        </Text>
        <Text style={styles.message}>{t('home.greeting')}</Text>
      </View>

      <View style={styles.appointment}>
        <View style={styles.sectionHeading}>
          <AppSymbol name="calendar" size={24} color={appColors.text} />
          <Text style={styles.sectionTitle}>{t('home.nextAppointment')}</Text>
        </View>
        {appointmentState === 'loading' ? (
          <Text testID="home-appointment-loading">
            {t('appointments.loading')}
          </Text>
        ) : appointmentState === 'failed' ? (
          <View style={styles.inlineState}>
            <Text accessibilityRole="alert">{t('appointments.loadError')}</Text>
            <AppButton
              onPress={onRetryAppointments}
              testID="home-appointments-retry"
              title={t('appointments.retry')}
            />
          </View>
        ) : nextAppointment ? (
          <View style={styles.section} testID="home-next-appointment">
            <Text style={styles.appointmentTime}>
              {formatDateTime(new Date(nextAppointment.effectiveAt))}
            </Text>
            <Text style={styles.appointmentClinic}>
              {nextAppointment.clinicLabel ??
                nextAppointment.calendarEventSnapshot?.title ??
                t('appointments.fallbackTitle')}
            </Text>
            <AppButton
              onPress={onPrepareVisit}
              testID="home-prepare-visit"
              title={t('home.prepareVisit')}
            />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenSchedule}
            style={styles.emptyAppointment}
            testID="home-open-schedule"
          >
            <Text style={styles.emptyText}>{t('home.noAppointment')}</Text>
            <AppSymbol name="chevron.right" size={14} />
          </Pressable>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.recentHeading} testID="home-open-records">
          {t('home.recentRecord')}
        </Text>
        {recordingState === 'loading' ? (
          <Text testID="home-recording-loading">
            {t('recording.library.loading')}
          </Text>
        ) : recordingState === 'failed' ? (
          <View style={styles.inlineState}>
            <Text accessibilityRole="alert">
              {t('recording.library.loadError')}
            </Text>
            <AppButton
              onPress={onRetryRecordings}
              testID="home-recordings-retry"
              title={t('appointments.retry')}
            />
          </View>
        ) : recentRecording ? (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenRecords}
            style={styles.recording}
            testID="home-recent-recording"
          >
            <AppSymbol name="doc.text" size={24} color={appColors.text} />
            <View style={styles.recordingCopy}>
              <Text style={styles.recordingTitle}>{recentRecording.title}</Text>
              <Text style={styles.recordingDate}>
                {formatRecordedAt(recentRecording.recordedAt)}
              </Text>
            </View>
            <AppSymbol name="chevron.right" size={14} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenRecords}
            style={styles.recording}
            testID="home-empty-recordings"
          >
            <Text style={styles.emptyText}>{t('home.noRecentRecord')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Let the shared ScrollView measure long Dynamic Type content past its viewport.
    gap: 32,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 28,
    backgroundColor: appColors.background,
  },
  header: { gap: 8 },
  title: { color: appColors.text, fontSize: 40, fontWeight: '700' },
  recentHeading: { color: appColors.secondary, fontSize: 14 },
  recordingCopy: { flex: 1, gap: 4 },
  recordingTitle: { color: appColors.text, fontSize: 16, fontWeight: '500' },
  message: { color: appColors.secondary, fontSize: 16, lineHeight: 24 },
  section: { gap: 12 },
  sectionHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 32,
  },
  sectionTitle: { color: appColors.text, fontSize: 17, fontWeight: '700' },
  appointment: {
    backgroundColor: appColors.surface,
    borderRadius: 16,
    gap: 10,
    padding: 20,
  },
  appointmentTime: { color: appColors.text, fontSize: 20, fontWeight: '700' },
  appointmentClinic: { color: appColors.secondary, fontSize: 14 },
  emptyAppointment: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 60,
    paddingHorizontal: 18,
  },
  recording: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
    backgroundColor: appColors.surface,
    borderRadius: 12,
    gap: 6,
    minHeight: 72,
    paddingHorizontal: 18,
  },
  recordingDate: { color: appColors.secondary, fontSize: 13 },
  emptyText: { color: appColors.secondary, fontSize: 15 },
  inlineState: { gap: 8 },
});

// Keep shared error-route styling available to CalendarAppRoute while using the Toss palette.
export const appRouteStyles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: appColors.background,
  },
  title: {
    color: appColors.text,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    color: appColors.secondary,
    fontSize: 16,
    textAlign: 'center',
  },
});
