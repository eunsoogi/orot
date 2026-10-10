import { StyleSheet, View } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import CalendarLinkingScreen from '../calendar/CalendarLinkingScreen';
import type { CalendarBridge } from '../calendar/types';
import { useNavigationLeaveStateRegistration } from '../navigation';

interface ScheduleRouteProps {
  readonly appointmentRepository: AppointmentRepository | null;
  readonly appointmentState: 'loading' | 'ready' | 'failed';
  readonly bridge: CalendarBridge;
  readonly onRetry: () => void;
  readonly onOpenAppointments: () => void;
  readonly onAppointmentsChanged: () => void;
}

/** Places calendar linking and appointment management under the Schedule tab. */
export function ScheduleRoute({
  appointmentRepository,
  appointmentState,
  bridge,
  onRetry,
  onOpenAppointments,
  onAppointmentsChanged,
}: ScheduleRouteProps) {
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });

  if (appointmentRepository) {
    return (
      <CalendarLinkingScreen
        bridge={bridge}
        heading={t('schedule.title')}
        onOpenAppointments={onOpenAppointments}
        onAppointmentsChanged={onAppointmentsChanged}
        repository={appointmentRepository}
      />
    );
  }

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('schedule.title')}
      </Text>
      <Text style={styles.message}>
        {appointmentState === 'loading'
          ? t('appointments.opening')
          : t('appointments.openError')}
      </Text>
      {appointmentState === 'failed' ? (
        <AppButton
          onPress={onRetry}
          testID="schedule-retry"
          title={t('appointments.retry')}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: appColors.background,
    flex: 1,
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  title: { color: appColors.text, fontSize: 40, fontWeight: '700' },
  message: { color: appColors.secondary, fontSize: 15, lineHeight: 23 },
});
