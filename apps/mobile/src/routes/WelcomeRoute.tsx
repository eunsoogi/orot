import { StyleSheet, View } from 'react-native';
import type { Appointment } from '@orot/storage';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { formatDate, t } from '../i18n';
import { appColors } from '../layout/appColors';
import { hubSpacing } from '../layout/hubSpacing';
import { NAVIGATION_CONTENT_GAP } from '../navigation/navigationLayout';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { NextVisitPanel } from './HomeSummaryPanels';
import { HomeMetrics } from './home/HomeMetrics';
import { HomePreparationQuestions } from './HomePreparationPanels';
import {
  useHomePreparationData,
  type HomePreparationLoaders,
} from './useHomePreparationData';

export interface WelcomeRouteProps extends HomePreparationLoaders {
  readonly appointment: Appointment | null;
  readonly appointmentState: 'loading' | 'ready' | 'failed';
  readonly recentRecording: RecordingSourceRecord | null;
  readonly recordingState: 'loading' | 'ready' | 'failed';
  readonly onRetryAppointments: () => void;
  readonly onRetryRecordings: () => void;
  readonly onPrepareVisit: () => void;
  readonly onOpenSchedule: () => void;
  readonly onOpenRecords: () => void;
  readonly onOpenRecording: () => void;
  readonly onOpenDailyReport?: () => void;
}

/** Keeps visit preparation and health metrics in one ordered page. */
export default function WelcomeRoute({
  appointment,
  appointmentState,
  onRetryAppointments,
  onPrepareVisit,
  onOpenSchedule,
  onOpenDailyReport,
  loadSavedVisitQuestions,
}: WelcomeRouteProps) {
  const preparation = useHomePreparationData(appointment?.id, {
    loadSavedVisitQuestions,
  });
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
        <Text style={styles.message}>
          {formatDate(new Date())} ·{' '}
          {t('home.localTimeZone', {
            zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          })}
        </Text>
      </View>

      {/* The shell consumes system/navigation geometry once and owns the only vertical scroll. */}
      <View style={styles.sections} testID="home-overview-sections">
        {onOpenDailyReport ? (
          <AppButton
            title={t('dailyReport.title')}
            variant="secondary"
            onPress={onOpenDailyReport}
          />
        ) : null}
        <NextVisitPanel
          appointment={appointment}
          appointmentState={appointmentState}
          onOpenSchedule={onOpenSchedule}
          onPrepareVisit={onPrepareVisit}
          onRetryAppointments={onRetryAppointments}
        >
          {appointment ? (
            <HomePreparationQuestions
              questions={
                preparation.questions?.appointmentId === appointment.id
                  ? preparation.questions
                  : null
              }
              state={preparation.questionState}
              onRetry={preparation.retry}
            />
          ) : null}
        </NextVisitPanel>
        <HomeMetrics />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Let the shared ScrollView measure long Dynamic Type content past its viewport.
    gap: hubSpacing.item,
    paddingHorizontal: hubSpacing.horizontal,
    paddingTop: hubSpacing.top,
    // The outer route scroller already contributes the shared navigation gap.
    paddingBottom: hubSpacing.bottom - NAVIGATION_CONTENT_GAP,
    backgroundColor: appColors.background,
  },
  header: { gap: 8 },
  sections: { gap: hubSpacing.item, minWidth: 0 },
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
