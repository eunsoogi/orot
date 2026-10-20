import { StyleSheet, Text, View } from 'react-native';
import { SelectedModelControl } from '../layout/SelectedModelControl';
import type { Appointment } from '@orot/domain';
import { AppSymbol } from '../layout/AppSymbol';
import { nextVisitQuestionsCopy as copy } from './copy';
import { formatNextVisitTime } from './format';
import type { NextVisitQuestionsTheme, ProviderViewState } from './types';

/** Compact context retains the actual appointment and time-zone fallback. */
export function VisitAppointmentCard({
  appointment,
  theme,
}: {
  readonly appointment: Appointment;
  readonly theme: NextVisitQuestionsTheme;
}) {
  const styles = contextStyles(theme);
  const time = formatNextVisitTime(appointment);
  const title =
    appointment.calendarEventSnapshot?.title?.trim() ||
    appointment.clinicLabel?.trim() ||
    copy.appointment.fallbackTitle;
  return (
    <View style={styles.card}>
      <View style={styles.icon}>
        <AppSymbol name="calendar" color={theme.colors.accentText} />
      </View>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        {appointment.clinicLabel && appointment.clinicLabel !== title ? (
          <Text style={styles.caption}>{appointment.clinicLabel}</Text>
        ) : null}
        <Text style={styles.caption} testID="next-visit-appointment-time">
          {time?.label ?? copy.appointment.timeUnavailable}
        </Text>
        {time?.timeZoneNote === 'device' ? (
          <Text style={styles.caption}>{copy.appointment.deviceTimeZone}</Text>
        ) : time?.timeZoneNote === 'calendar_unreadable' ? (
          <Text style={styles.warning}>
            {copy.appointment.invalidCalendarTimeZone}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** The provider change action keeps the real data transmission boundary visible. */
export function VisitProviderCard({
  provider,
  onChoose,
  theme,
}: {
  readonly provider: Extract<ProviderViewState, { status: 'available' }>;
  readonly onChoose: () => void;
  readonly theme: NextVisitQuestionsTheme;
}) {
  const styles = contextStyles(theme);
  return (
    <View testID="next-visit-provider">
      <SelectedModelControl
        name={provider.displayName}
        local={provider.privacyBoundary === 'on-device'}
        label={`${copy.provider.choose}, ${provider.displayName}`}
        onPress={onChoose}
        testID="next-visit-provider-select"
      />
      <Text style={styles.caption}>
        {provider.privacyBoundary === 'on-device'
          ? copy.provider.onDevice
          : copy.provider.remote}
      </Text>
    </View>
  );
}

function contextStyles({ colors }: NextVisitQuestionsTheme) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      borderRadius: 16,
      backgroundColor: colors.surfaceSubtle,
    },
    provider: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      minHeight: 64,
    },
    icon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.accentSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: { flex: 1, gap: 4 },
    title: { fontSize: 16, fontWeight: '600', color: colors.text },
    caption: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
    warning: { fontSize: 14, lineHeight: 20, color: colors.warning },
  });
}
