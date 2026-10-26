import { useSyncExternalStore } from 'react';
import { View } from 'react-native';
import type { Appointment } from '@orot/storage';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { useAppointmentReminderRuntime } from './AppointmentReminderContext';
import type { AppointmentReminderRuntime } from './AppointmentReminderContext';
import { appointmentStartTime } from '../calendar/appointmentTime';

/** Permission is requested only by an explicit card action; default is off. */
export function AppointmentReminderControls({
  appointment,
}: {
  readonly appointment: Appointment;
}) {
  const runtime = useAppointmentReminderRuntime();
  if (
    !runtime ||
    !['scheduled', 'rescheduled'].includes(appointment.status) ||
    appointmentStartTime(appointment) <= Date.now()
  )
    return null;
  return <Controls runtime={runtime} appointment={appointment} />;
}

function Controls({
  runtime,
  appointment,
}: {
  readonly runtime: AppointmentReminderRuntime;
  readonly appointment: Appointment;
}) {
  const coordinator = runtime.coordinator;
  const state = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
  );
  const selected = state.selection?.appointmentId === appointment.id;
  const select = (leadMinutes: 60 | 1440 | null) => {
    coordinator
      .select(
        leadMinutes === null
          ? null
          : { appointmentId: appointment.id, leadMinutes },
      )
      .catch(() => undefined);
  };
  return (
    <View>
      <AppText>진료 준비 알림 · 한 예약에만 설정할 수 있어요.</AppText>
      <AppText>잠금 화면에는 예약 내용 없이 준비 안내만 표시해요.</AppText>
      {([60, 1440] as const).map(minutes => (
        <AppButton
          key={minutes}
          disabled={state.busy}
          title={minutes === 60 ? '1시간 전 알림' : '하루 전 알림'}
          testID={`appointment-reminder-${appointment.id}-${minutes}`}
          onPress={() => select(minutes)}
        />
      ))}
      {selected ? (
        <>
          <AppText accessibilityLiveRegion="polite">
            {state.status === 'scheduled'
              ? '알림이 설정되었어요.'
              : '알림이 예약되지 않았어요. 시간과 알림 권한을 확인해 주세요.'}
          </AppText>
          <AppButton
            title="알림 끄기"
            disabled={state.busy}
            onPress={() => select(null)}
            testID={`appointment-reminder-off-${appointment.id}`}
          />
        </>
      ) : null}
      {state.status === 'error' || state.status === 'denied' ? (
        <AppText accessibilityRole="alert">
          {state.status === 'denied'
            ? '알림 권한이 없어요. 설정에서 Orot 알림을 허용해 주세요.'
            : '알림을 갱신하지 못했어요. 다시 설정하거나 꺼 주세요.'}
        </AppText>
      ) : null}
    </View>
  );
}
