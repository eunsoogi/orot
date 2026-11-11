import { useState, useSyncExternalStore } from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { ReactNode } from 'react';
import type { Appointment } from '@orot/storage';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { useAppointmentReminderRuntime } from './AppointmentReminderContext';
import type { AppointmentReminderRuntime } from './AppointmentReminderContext';
import { appointmentStartTime } from '../calendar/appointmentTime';
import { beginReminderAction } from './reminderActionObservation';

/** Side-by-side panels need room for the reminder copy and its choice row. */
const REMINDER_TWO_PANEL_MIN_WIDTH = 480;
// Split Korean labels and compact-button padding still fit on a narrow iPhone card.
const REMINDER_ACTION_MIN_WIDTH = 92;

/** Permission is requested only by an explicit card action; default is off. */
export function AppointmentReminderControls({
  appointment,
  additionalAction,
}: {
  readonly appointment: Appointment;
  /** The appointment card owns this action and its callback, but shares the row. */
  readonly additionalAction?: ReactNode;
}) {
  const runtime = useAppointmentReminderRuntime();
  const { fontScale } = useWindowDimensions();
  const textScale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  if (
    !runtime ||
    !['scheduled', 'rescheduled'].includes(appointment.status) ||
    appointmentStartTime(appointment) <= Date.now()
  ) {
    return additionalAction ? (
      <ActionRow>
        <ActionCell textScale={textScale}>{additionalAction}</ActionCell>
      </ActionRow>
    ) : null;
  }
  return (
    <Controls
      additionalAction={additionalAction}
      runtime={runtime}
      appointment={appointment}
    />
  );
}

function Controls({
  runtime,
  appointment,
  additionalAction,
}: {
  readonly runtime: AppointmentReminderRuntime;
  readonly appointment: Appointment;
  readonly additionalAction?: ReactNode;
}) {
  const coordinator = runtime.coordinator;
  const { fontScale } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const state = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
  );
  const selected = state.selection?.appointmentId === appointment.id;
  const textScale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  const horizontal =
    !additionalAction &&
    measuredWidth !== null &&
    measuredWidth >= REMINDER_TWO_PANEL_MIN_WIDTH * textScale;
  const select = (leadMinutes: 60 | 1440 | null) => {
    const settle = beginReminderAction(coordinator.getSnapshot(), coordinator);
    coordinator
      .select(
        leadMinutes === null
          ? null
          : { appointmentId: appointment.id, leadMinutes },
      )
      .then(
        () => settle('resolve', coordinator.getSnapshot()),
        error => settle('reject', coordinator.getSnapshot(), error),
      );
  };
  return (
    <View
      // The detail panel can be narrower than the window; size this control from its own parent.
      onLayout={({ nativeEvent: { layout } }) => {
        const nextWidth = layout.width;
        if (!Number.isFinite(nextWidth) || nextWidth <= 0) return;
        setMeasuredWidth(previous =>
          previous !== null && Math.abs(previous - nextWidth) < 0.5
            ? previous
            : nextWidth,
        );
      }}
      style={[styles.container, horizontal && styles.horizontal]}
      testID="appointment-reminder-controls"
    >
      <View style={[styles.preview, horizontal && styles.horizontalPanel]}>
        <AppText
          accessibilityRole="header"
          style={styles.title}
          testID="appointment-reminder-title"
        >
          {t('appointments.reminder.title')}
        </AppText>
        <AppText>진료 준비 알림 · 한 예약에만 설정할 수 있어요.</AppText>
        <AppText>잠금 화면에는 예약 내용 없이 준비 안내만 표시해요.</AppText>
      </View>
      <ActionRow style={horizontal && styles.horizontalPanel}>
        {([60, 1440] as const).map(minutes => {
          const label = minutes === 60 ? '1시간 전 알림' : '하루 전 알림';
          const isSelected =
            selected && state.selection?.leadMinutes === minutes;
          return (
            <ActionCell key={minutes} textScale={textScale}>
              <AppButton
                accessibilityLabel={label}
                accessibilityState={{ selected: isSelected }}
                disabled={state.busy}
                onPress={() => select(minutes)}
                size="compact"
                testID={`appointment-reminder-${appointment.id}-${minutes}`}
                title={label.replace(' ', '\n')}
                variant={isSelected ? 'primary' : 'secondary'}
              />
            </ActionCell>
          );
        })}
        {additionalAction ? (
          <ActionCell textScale={textScale}>{additionalAction}</ActionCell>
        ) : null}
      </ActionRow>
      {selected ? (
        <View style={styles.feedback}>
          <AppText accessibilityLiveRegion="polite">
            {state.status === 'scheduled'
              ? '알림이 설정되었어요.'
              : '알림이 예약되지 않았어요. 시간과 알림 권한을 확인해 주세요.'}
          </AppText>
          <AppButton
            title="알림 끄기"
            disabled={state.busy}
            size="compact"
            onPress={() => select(null)}
            testID={`appointment-reminder-off-${appointment.id}`}
            variant="secondary"
          />
        </View>
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

function ActionRow({
  children,
  style,
}: {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.actions, style]} testID="appointment-reminder-actions">
      {children}
    </View>
  );
}

/** Scaled minimums wrap whole controls before text or touch targets can shrink. */
function ActionCell({
  children,
  textScale,
}: {
  readonly children: ReactNode;
  readonly textScale: number;
}) {
  return (
    <View
      style={[
        styles.actionCell,
        { minWidth: REMINDER_ACTION_MIN_WIDTH * textScale },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'column', gap: 12, minWidth: 0 },
  horizontal: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  preview: { gap: 8, minWidth: 0 },
  title: { color: appColors.text, fontSize: 16, fontWeight: '700' },
  // Wrap compact choices instead of shrinking their minimum native hit areas.
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 8,
    minWidth: 0,
  },
  actionCell: { flexBasis: 0, flexGrow: 1, flexShrink: 0 },
  feedback: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  horizontalPanel: { flex: 1 },
});
