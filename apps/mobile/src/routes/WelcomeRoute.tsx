import { StyleSheet, View } from 'react-native';
import type { Appointment } from '@orot/storage';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { AppButton } from '../layout/AppButton';
import { hubSpacing } from '../layout/hubSpacing';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { NextVisitPanel, RecentRecordsPanel } from './HomeSummaryPanels';
import {
  HomeOngoingSymptoms,
  HomePreparationQuestions,
} from './HomePreparationPanels';
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
  readonly onOpenSymptoms: () => void;
  readonly onOpenRecording: () => void;
}

/** Keeps visit preparation, active symptoms, recent audio and capture in one ordered page. */
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
  onOpenSymptoms,
  onOpenRecording,
  loadSymptoms,
  loadSavedVisitQuestions,
}: WelcomeRouteProps) {
  const preparation = useHomePreparationData(appointment?.id, {
    loadSymptoms,
    loadSavedVisitQuestions,
  });
  const newUser =
    appointmentState === 'ready' &&
    !appointment &&
    recordingState === 'ready' &&
    !recentRecording &&
    preparation.symptomState === 'ready' &&
    preparation.symptoms.length === 0;
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

      {/* The shell consumes system/navigation geometry once and owns the only vertical scroll. */}
      <View style={styles.sections} testID="home-overview-sections">
        {newUser ? (
          <Text testID="home-first-action-guidance" style={styles.message}>
            {t('home.newUser')}
          </Text>
        ) : (
          <>
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
            <HomeOngoingSymptoms
              symptoms={preparation.symptoms}
              state={preparation.symptomState}
              onRetry={preparation.retry}
              onOpen={onOpenSymptoms}
            />
            <RecentRecordsPanel
              recentRecording={recentRecording}
              recordingState={recordingState}
              onOpenRecords={onOpenRecords}
              onRetryRecordings={onRetryRecordings}
            />
          </>
        )}
        <AppButton
          title={t('home.newRecording')}
          onPress={onOpenRecording}
          testID="home-new-recording"
        />
        {newUser ? (
          <AppButton
            title={t('symptoms.title')}
            onPress={onOpenSymptoms}
            testID="home-first-symptom"
          />
        ) : null}
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
    paddingBottom: hubSpacing.bottom,
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
