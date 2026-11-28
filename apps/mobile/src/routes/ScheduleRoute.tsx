import { StyleSheet, View } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import CalendarLinkingScreen from '../calendar/CalendarLinkingScreen';
import type { CalendarBridge } from '../calendar/types';
import type { CalendarAutoSyncState } from '../calendar/calendarAutoSync';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { RecordsPageBackdrop } from './RecordsPageBackdrop';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';

interface ScheduleRouteProps {
  readonly appointmentRepository: AppointmentRepository | null;
  readonly appointmentState: 'loading' | 'ready' | 'failed';
  readonly bridge: CalendarBridge;
  readonly calendarSync: CalendarAutoSyncState;
  readonly onRetry: () => void;
  readonly onOpenAppointments: () => void;
  readonly onOpenMedicalAppointments: () => void;
  readonly onAppointmentsChanged: () => void;
}

/** Places calendar linking and appointment management in the Records stack without a second scroll host. */
export function ScheduleRoute({
  appointmentRepository,
  appointmentState,
  bridge,
  calendarSync,
  onRetry,
  onOpenAppointments,
  onOpenMedicalAppointments,
  onAppointmentsChanged,
}: ScheduleRouteProps) {
  const label = t('appointments.retry');
  const hasDock = useNavigationRouteActions(
    !appointmentRepository && appointmentState === 'failed'
      ? [
          {
            id: 'retry-schedule',
            label,
            accessibilityLabel: label,
            testID: 'schedule-retry',
            systemImageName: 'arrow.clockwise',
            onPress: onRetry,
          },
        ]
      : [],
  );
  if (appointmentRepository) {
    return (
      <View style={styles.screen}>
        <RecordsPageBackdrop />
        <CalendarLinkingScreen
          bridge={bridge}
          calendarSync={calendarSync}
          adaptiveScheduleLayout
          embeddedInHubScroll
          flatSchedulePresentation
          heading={t('schedule.title')}
          onOpenAppointments={onOpenAppointments}
          onOpenMedicalAppointments={onOpenMedicalAppointments}
          onAppointmentsChanged={onAppointmentsChanged}
          repository={appointmentRepository}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <RecordsPageBackdrop />
      <ScheduleUnavailableGuard />
      <Text accessibilityRole="header" style={styles.title}>
        {t('schedule.title')}
      </Text>
      <Text style={styles.message}>
        {appointmentState === 'loading'
          ? t('appointments.opening')
          : t('appointments.openError')}
      </Text>
      {appointmentState === 'failed' && !hasDock ? (
        <AppButton
          onPress={onRetry}
          testID="schedule-retry"
          title={t('appointments.retry')}
        />
      ) : null}
    </View>
  );
}

/** When the calendar cannot mount, its passive recovery state still owns Back. */
function ScheduleUnavailableGuard() {
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });
  return null;
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, minWidth: 0 },
  container: {
    flexGrow: 1,
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  title: { color: appColors.text, fontSize: 36, fontWeight: '700' },
  message: { color: appColors.secondary, fontSize: 15, lineHeight: 23 },
});
