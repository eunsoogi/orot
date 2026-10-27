import { StyleSheet, View } from 'react-native';
import type { Appointment } from '@orot/storage';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { NextVisitPanel, RecentRecordsPanel } from './HomeSummaryPanels';

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

  return (
    <View style={styles.container} testID="home-screen">
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

      {/* The route shell reserves safe and navigation regions; only these two summaries reflow inside it. */}
      <AdaptiveColumns
        primary={
          <NextVisitPanel
            appointment={appointment}
            appointmentState={appointmentState}
            onOpenSchedule={onOpenSchedule}
            onPrepareVisit={onPrepareVisit}
            onRetryAppointments={onRetryAppointments}
          />
        }
        secondary={
          <RecentRecordsPanel
            recentRecording={recentRecording}
            recordingState={recordingState}
            onOpenRecords={onOpenRecords}
            onRetryRecordings={onRetryRecordings}
          />
        }
        testID="home-adaptive-columns"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Let the shared ScrollView measure long Dynamic Type content past its viewport.
    gap: 28,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 28,
    backgroundColor: appColors.background,
  },
  header: { gap: 8 },
  title: { color: appColors.text, fontSize: 36, fontWeight: '700' },
  message: { color: appColors.secondary, fontSize: 16, lineHeight: 24 },
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
